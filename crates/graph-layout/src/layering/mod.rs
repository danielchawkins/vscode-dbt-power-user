//! Rank assignment and dummy chains for the layered layout: the ranks of the nodes and, for each bundle of parallel edges,
//! the chain of dummy nodes that carries it across the ranks it spans. A port of `packages/graph-layout/src/rank/index.ts`
//! and the bundle and chain parts of `layering.ts` and `bundles.ts`. Cluster chains, lateral ports, spines and segments
//! are not ported here (ADR 0011 keeps them in later phases).
//!
//! Imports: `index`, `budget`, `rand` and `solve` only (ADR 0011). This phase needs none of `rand` and `solve`, since
//! network simplex is deterministic and has no random tie-breaks.
//!
//! Allocation: [`Scratch`] holds every buffer that ranking and layering use. [`rank_into`] and [`layer_into`] write
//! into outputs the caller owns, so once the buffers have grown to the graph they allocate nothing for the same graph.
//! [`rank`] and [`layer`] return fresh outputs, for callers that do not keep them.

mod acyclic;
mod constraints;
pub(crate) mod layered;
mod network;
mod tree;

pub(crate) use layered::{LayeredGraph, PortDummy};

#[cfg(test)]
pub(crate) use layered::{LayeredNode, Segment};

#[cfg(test)]
mod key_tests;
#[cfg(test)]
mod network_tests;
#[cfg(test)]
mod tests;

use crate::budget::Budget;
use crate::index::Indexed;

use acyclic::CycleScratch;
use constraints::{hint_constraints, partition_constraints};
use network::{NetworkEdge, Simplex, network_simplex};

/// How nodes in bands are kept in order (`LayoutOptions.partitions`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PartitionMode {
    None,
    Soft,
    Strict,
}

/// What the layering needs to know about an edge: the policy of its kind, and the lateral port at each end. An edge
/// whose kind has no policy has `ranks: false`, `min_length: 1` and `weight: 1`, which is what `policy ?? defaults`
/// gives in `rank/index.ts`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct EdgeRule {
    /// The dense id of the edge's kind, numbered in order of first appearance.
    pub(crate) kind: usize,
    pub(crate) ranks: bool,
    pub(crate) min_length: f64,
    pub(crate) weight: f64,
    /// The row of the port at each end (source, target), when that port sits on a side lateral to the flow. Edges
    /// whose lateral ports differ go to different bundles, so each lateral port has its own port dummy.
    pub(crate) ports: [Option<usize>; 2],
}

/// Everything ranking reads besides the graph itself.
pub(crate) struct RankOptions<'a> {
    pub(crate) partitions: PartitionMode,
    /// The partition band of each node, by node index. Only read when `partitions` is not `None`.
    pub(crate) node_partition: &'a [Option<f64>],
    /// The rule of each edge, by edge index.
    pub(crate) edges: &'a [EdgeRule],
    /// The hinted rank of each node, by node index. Empty when the run has no hints.
    pub(crate) hints: &'a [Option<u32>],
    /// The weight of the hints. Zero or less turns them off.
    pub(crate) stability: f64,
    pub(crate) budget: &'a Budget,
}

/// The rank of each node (lowest real node at 0) and the indices of the ranking edges that are laid out against their
/// direction, in edge order.
#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct Ranks {
    pub(crate) ranks: Vec<f64>,
    pub(crate) reversed: Vec<usize>,
}

/// Why ranking failed. The constraints of a validated graph never trigger these; they guard the search.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RankError {
    /// The ranking constraints contain a cycle.
    Cycle,
    /// The ranking network is not connected.
    Disconnected,
    /// A non-tree edge would be needed to lower the cost, but none exists.
    Unbounded,
}

impl std::fmt::Display for RankError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Cycle => write!(f, "the ranking constraints contain a cycle"),
            Self::Disconnected => write!(f, "the ranking network is not connected"),
            Self::Unbounded => write!(f, "the ranking network has no edge that lowers its cost"),
        }
    }
}

/// A ranking edge in the direction it is ranked, which can differ from its source and target.
#[derive(Debug, Clone, Copy)]
struct RankingEdge {
    id: usize,
    from: usize,
    to: usize,
    min_length: f64,
    weight: f64,
    reversed: bool,
    /// Under strict partitions, whether the edge joins two bands. Its band order already orients it, and it lies on no
    /// cycle, so cycle breaking must leave it alone.
    across_bands: bool,
}

/// The buffers that ranking and layering reuse between calls. Keep one per thread and pass it to every call, as
/// `solve`'s projector does: the buffers grow to the largest graph seen and are cleared, not reallocated, on the next
/// call. A [`Layers`] that is reused keeps its bundles' buffers too, up to the bundle count of the largest graph.
#[derive(Debug, Default)]
pub(crate) struct Scratch {
    edges: Vec<RankingEdge>,
    arcs: Vec<(usize, usize)>,
    cycles: CycleScratch,
    partitions: Vec<Option<f64>>,
    bands: Vec<f64>,
    hinted: Vec<(usize, u32)>,
    network: Vec<NetworkEdge>,
    simplex: Simplex,
    keyed: Vec<(BundleKey, usize)>,
    members: Vec<usize>,
    spans: Vec<(usize, usize, usize)>,
}

/// Chooses the ranks of the nodes: the weighted length of the ranking edges is least, every ranking edge spans its
/// minimum length, and the partitions and the hints hold as far as they are asked to. Only edge kinds whose policy
/// ranks take part. Under strict partitions an edge that points back across bands is ranked backwards.
pub(crate) fn rank(
    graph: &Indexed,
    options: &RankOptions<'_>,
    scratch: &mut Scratch,
) -> Result<Ranks, RankError> {
    let mut out = Ranks::default();
    rank_into(graph, options, scratch, &mut out)?;
    Ok(out)
}

/// [`rank`], writing into `out`. Allocates nothing once `scratch` and `out` have grown to the graph.
pub(crate) fn rank_into(
    graph: &Indexed,
    options: &RankOptions<'_>,
    scratch: &mut Scratch,
    out: &mut Ranks,
) -> Result<(), RankError> {
    out.ranks.clear();
    out.reversed.clear();
    let nodes = graph.node_count();
    if nodes == 0 {
        return Ok(());
    }
    let strict = options.partitions == PartitionMode::Strict;
    ranking_edges(graph, options, strict, &mut scratch.edges);
    break_cycles(&mut scratch.edges, &mut scratch.arcs, &mut scratch.cycles);
    scratch.network.clear();
    scratch
        .network
        .extend(scratch.edges.iter().map(|e| NetworkEdge {
            tail: e.from,
            head: e.to,
            min_length: e.min_length,
            weight: e.weight,
        }));
    let count = match options.partitions {
        PartitionMode::None => nodes,
        mode => {
            scratch.partitions.clear();
            scratch.partitions.extend(
                options
                    .node_partition
                    .iter()
                    .map(|p| if strict { Some(p.unwrap_or(0.0)) } else { *p }),
            );
            partition_constraints(
                &scratch.partitions,
                mode,
                &mut scratch.bands,
                &mut scratch.network,
            )
        }
    };
    let stability = options.stability;
    let hint_ranks: &[Option<u32>] = if options.hints.is_empty() || stability <= 0.0 {
        &[]
    } else {
        options.hints
    };
    let count = hint_constraints(
        count,
        hint_ranks,
        stability,
        &mut scratch.hinted,
        &mut scratch.network,
    );
    let solved = network_simplex(
        count,
        &scratch.network,
        options.budget.rank_pivots,
        &mut scratch.simplex,
    )?;
    let real = &solved[..nodes];
    let low = real.iter().fold(f64::INFINITY, |least, &r| least.min(r));
    out.ranks.extend(real.iter().map(|&r| r - low));
    out.reversed
        .extend(scratch.edges.iter().filter(|e| e.reversed).map(|e| e.id));
    Ok(())
}

/// The ranking edges, oriented: an edge of a kind that does not rank, an edge with unknown ends, or a self-loop, takes
/// no part.
fn ranking_edges(
    graph: &Indexed,
    options: &RankOptions<'_>,
    strict: bool,
    out: &mut Vec<RankingEdge>,
) {
    let band = |node: usize| options.node_partition[node].unwrap_or(0.0);
    out.clear();
    for (id, rule) in options.edges.iter().enumerate() {
        let Some((source, target)) = graph.ends(id) else {
            continue;
        };
        let (source, target) = (source as usize, target as usize);
        if !rule.ranks || source == target {
            continue;
        }
        let (source_band, target_band) = (band(source), band(target));
        let backward = strict && source_band > target_band;
        let (from, to) = if backward {
            (target, source)
        } else {
            (source, target)
        };
        out.push(RankingEdge {
            id,
            from,
            to,
            min_length: rule.min_length,
            weight: rule.weight,
            reversed: backward,
            across_bands: strict && (source_band < target_band || backward),
        });
    }
}

/// Flips the edges that the greedy order of `acyclic` reports, so the ranking graph has no cycle. `arcs` is scratch for
/// the edges' ends. An edge across bands is passed as a self-loop, which the greedy order never reports, so it is never
/// flipped: a flip would point it against the band order, and the strict gate arcs would then close a cycle.
fn break_cycles(
    edges: &mut [RankingEdge],
    arcs: &mut Vec<(usize, usize)>,
    cycles: &mut CycleScratch,
) {
    arcs.clear();
    arcs.extend(edges.iter().map(|e| {
        if e.across_bands {
            (e.from, e.from)
        } else {
            (e.from, e.to)
        }
    }));
    for &i in cycles.reversed_arcs(arcs.as_slice()) {
        let e = &mut edges[i];
        std::mem::swap(&mut e.from, &mut e.to);
        e.reversed = !e.reversed;
    }
}

/// Clears the first `count` adjacency lists, growing the outer list when it is short. The inner lists keep their
/// capacity, so a list that has held its edges before does not allocate again.
fn reset_lists(lists: &mut Vec<Vec<usize>>, count: usize) {
    if lists.len() < count {
        lists.resize_with(count, Vec::new);
    }
    for list in &mut lists[..count] {
        list.clear();
    }
}

/// A point on a bundle's chain: a real node, or a dummy by its index in `Layers::dummies`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ChainNode {
    Node(usize),
    Dummy(usize),
}

/// The stable key of a dummy: the first member edge of the bundle that carries it, the rank it sits on, and its
/// position in the chain. Edge indices follow the input order, so the key is the same for every run on the same input.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct DummyKey {
    pub(crate) owner: usize,
    pub(crate) rank: f64,
    pub(crate) position: usize,
}

/// One bundle: the parallel edges of one kind between one ordered pair of nodes, and the chain that carries them from
/// the upper end to the lower one.
#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct Bundle {
    pub(crate) kind: usize,
    pub(crate) source: usize,
    pub(crate) target: usize,
    pub(crate) edges: Vec<usize>,
    pub(crate) chain: Vec<ChainNode>,
    pub(crate) reversed: bool,
    pub(crate) flat: bool,
    pub(crate) weight: f64,
}

/// The bundles of a graph, and the keys of their dummies in creation order.
#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct Layers {
    pub(crate) bundles: Vec<Bundle>,
    pub(crate) dummies: Vec<DummyKey>,
}

/// Lays the graph out in ranks: one bundle per kind and ordered pair of nodes, with a dummy chain across each rank the
/// bundle spans. Self-loops and edges with unknown ends take no part. Bundles are in order of their first edge.
pub(crate) fn layer(graph: &Indexed, edges: &[EdgeRule], ranks: &[f64]) -> Layers {
    let mut out = Layers::default();
    layer_into(graph, edges, ranks, &mut Scratch::default(), &mut out);
    out
}

/// [`layer`], writing into `out`. Bundles that `out` already holds are reused in place; a surplus is dropped. Allocates
/// nothing once `scratch` and `out` have grown to the graph.
pub(crate) fn layer_into(
    graph: &Indexed,
    edges: &[EdgeRule],
    ranks: &[f64],
    scratch: &mut Scratch,
    out: &mut Layers,
) {
    group_bundles(
        graph,
        edges,
        &mut scratch.keyed,
        &mut scratch.members,
        &mut scratch.spans,
    );
    let Layers { bundles, dummies } = out;
    dummies.clear();
    let mut count = 0;
    for &(_, start, end) in &scratch.spans {
        if count == bundles.len() {
            bundles.push(Bundle::default());
        }
        add_bundle(
            graph,
            &mut bundles[count],
            dummies,
            edges,
            ranks,
            &scratch.members[start..end],
        );
        count += 1;
    }
    bundles.truncate(count);
}

/// A bundle's identity: its kind, its ordered pair of nodes, and the ports at each end.
type BundleKey = (usize, usize, usize, [Option<usize>; 2]);

/// The non-self-loop edges, grouped by kind and ordered pair of nodes. `members` holds the groups' edges, each group one
/// run in input order, and `spans` the `(first edge, start, end)` of each group, in order of first appearance.
fn group_bundles(
    graph: &Indexed,
    edges: &[EdgeRule],
    keyed: &mut Vec<(BundleKey, usize)>,
    members: &mut Vec<usize>,
    spans: &mut Vec<(usize, usize, usize)>,
) {
    keyed.clear();
    for (id, rule) in edges.iter().enumerate() {
        let Some((source, target)) = graph.ends(id) else {
            continue;
        };
        let (source, target) = (source as usize, target as usize);
        if source == target {
            continue;
        }
        keyed.push(((rule.kind, source, target, rule.ports), id));
    }
    // Sorting by key and then edge makes each key's edges one run, in input order.
    keyed.sort_unstable();
    members.clear();
    spans.clear();
    let mut k = 0;
    while k < keyed.len() {
        let key = keyed[k].0;
        let first = keyed[k].1;
        let start = members.len();
        while k < keyed.len() && keyed[k].0 == key {
            members.push(keyed[k].1);
            k += 1;
        }
        spans.push((first, start, members.len()));
    }
    // The first edges are distinct, so the order is total.
    spans.sort_unstable_by_key(|&(first, _, _)| first);
}

/// Sets the bundle of one group of parallel edges and, unless it is flat, the dummy chain that carries it. The bundle's
/// buffers are reused.
fn add_bundle(
    graph: &Indexed,
    bundle: &mut Bundle,
    dummies: &mut Vec<DummyKey>,
    edges: &[EdgeRule],
    ranks: &[f64],
    members: &[usize],
) {
    let first = members[0];
    let (source, target) = graph
        .ends(first)
        .map_or((0, 0), |(s, t)| (s as usize, t as usize));
    let reversed = ranks[source] > ranks[target];
    let (upper, lower) = if reversed {
        (target, source)
    } else {
        (source, target)
    };
    let flat = ranks[upper].to_bits() == ranks[lower].to_bits();
    let count = u32::try_from(members.len()).unwrap_or(u32::MAX);
    bundle.kind = edges[first].kind;
    bundle.source = source;
    bundle.target = target;
    bundle.edges.clear();
    bundle.edges.extend_from_slice(members);
    bundle.reversed = reversed;
    bundle.flat = flat;
    bundle.weight = edges[first].weight * f64::from(count).sqrt();
    bundle.chain.clear();
    bundle.chain.push(ChainNode::Node(upper));
    if !flat {
        let mut r = ranks[upper] + 1.0;
        while r < ranks[lower] {
            dummies.push(DummyKey {
                owner: first,
                rank: r,
                position: bundle.chain.len(),
            });
            bundle.chain.push(ChainNode::Dummy(dummies.len() - 1));
            r += 1.0;
        }
    }
    bundle.chain.push(ChainNode::Node(lower));
}
