//! Rank assignment and dummy chains for the layered layout: the ranks of the nodes and, for each bundle of parallel edges,
//! the chain of dummy nodes that carries it across the ranks it spans. A port of `packages/graph-layout/src/rank/index.ts`
//! and the bundle and chain parts of `layering.ts` and `bundles.ts`. Cluster chains, lateral ports, spines and segments
//! are not ported here (ADR 0011 keeps them in later phases).
//!
//! Imports: `index`, `budget`, `rand` and `solve` only (ADR 0011). This phase needs none of `rand` and `solve`, since
//! network simplex is deterministic and has no random tie-breaks.
//!
//! Allocation: [`Scratch`] reuses three outer buffers across calls. Four steps still allocate on every call (cycle
//! breaking, the partition and hint constraints, and network simplex). Making them allocation-free is Phase 7's
//! zero-allocation gate, and this module does not claim it before then.

mod acyclic;
mod constraints;
mod layered;
mod network;
mod tree;

pub(crate) use layered::{LayeredGraph, LayeredNode, Segment};

#[cfg(test)]
mod key_tests;
#[cfg(test)]
mod network_tests;
#[cfg(test)]
mod tests;

use std::collections::BTreeMap;

use crate::budget::Budget;
use crate::index::Indexed;

use acyclic::reversed_arcs;
use constraints::{Extension, hint_constraints, partition_constraints};
use network::{NetworkEdge, network_simplex};

/// How nodes in bands are kept in order (`LayoutOptions.partitions`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PartitionMode {
    None,
    Soft,
    Strict,
}

/// What the layering needs to know about the policy of an edge's kind. An edge whose kind has no policy has
/// `ranks: false`, `min_length: 1` and `weight: 1`, which is what `policy ?? defaults` gives in `rank/index.ts`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct EdgeRule {
    /// The dense id of the edge's kind, numbered in order of first appearance.
    pub(crate) kind: usize,
    pub(crate) ranks: bool,
    pub(crate) min_length: f64,
    pub(crate) weight: f64,
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
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Ranks {
    pub(crate) ranks: Vec<f64>,
    pub(crate) reversed: Vec<usize>,
}

/// Why ranking failed. The constraints of a validated graph never trigger these; they guard the search.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RankError {
    /// The ranking constraints contain a cycle.
    Cycle,
    /// The ranking network is not connected.
    Disconnected,
    /// A non-tree edge would be needed to lower the cost, but none exists.
    Unbounded,
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
}

/// The buffers that ranking reuses between calls. Keep one per thread and pass it to every [`rank`] call, as `solve`'s
/// projector does: the buffers grow to the largest graph seen and are cleared, not reallocated, on the next call. The
/// ranks and reversed edges are still allocated per call, since they are returned.
///
/// Three outer buffers are held here: `edges`, `partitions` and `network`. Not yet reused, and still allocated on every
/// call: the arc list of [`break_cycles`] (and what `reversed_arcs` builds from it), the results of
/// `partition_constraints` and `hint_constraints`, and the working vectors of `network_simplex`. Removing those is
/// Phase 7's zero-allocation gate (S5), so this phase does not claim zero allocations.
#[derive(Debug, Default)]
pub(crate) struct Scratch {
    edges: Vec<RankingEdge>,
    partitions: Vec<Option<f64>>,
    network: Vec<NetworkEdge>,
}

/// Chooses the ranks of the nodes: the weighted length of the ranking edges is least, every ranking edge spans its
/// minimum length, and the partitions and the hints hold as far as they are asked to. Only edge kinds whose policy
/// ranks take part. Under strict partitions an edge that points back across bands is ranked backwards.
pub(crate) fn rank(
    graph: &Indexed,
    options: &RankOptions<'_>,
    scratch: &mut Scratch,
) -> Result<Ranks, RankError> {
    let nodes = graph.node_count();
    if nodes == 0 {
        return Ok(Ranks {
            ranks: Vec::new(),
            reversed: Vec::new(),
        });
    }
    let strict = options.partitions == PartitionMode::Strict;
    ranking_edges(graph, options, strict, &mut scratch.edges);
    break_cycles(&mut scratch.edges);
    scratch.network.clear();
    scratch
        .network
        .extend(scratch.edges.iter().map(|e| NetworkEdge {
            tail: e.from,
            head: e.to,
            min_length: e.min_length,
            weight: e.weight,
        }));
    let bands = match options.partitions {
        PartitionMode::None => Extension {
            count: nodes,
            edges: Vec::new(),
        },
        mode => {
            scratch.partitions.clear();
            scratch.partitions.extend(
                options
                    .node_partition
                    .iter()
                    .map(|p| if strict { Some(p.unwrap_or(0.0)) } else { *p }),
            );
            partition_constraints(&scratch.partitions, mode)
        }
    };
    let stability = options.stability;
    let hint_ranks: &[Option<u32>] = if options.hints.is_empty() || stability <= 0.0 {
        &[]
    } else {
        options.hints
    };
    let hints = hint_constraints(bands.count, hint_ranks, stability);
    scratch.network.extend(bands.edges);
    scratch.network.extend(hints.edges);
    let solved = network_simplex(hints.count, &scratch.network, options.budget.rank_pivots)?;
    let real = &solved[..nodes];
    let low = real.iter().fold(f64::INFINITY, |least, &r| least.min(r));
    Ok(Ranks {
        ranks: real.iter().map(|&r| r - low).collect(),
        reversed: scratch
            .edges
            .iter()
            .filter(|e| e.reversed)
            .map(|e| e.id)
            .collect(),
    })
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
        let backward = strict && band(source) > band(target);
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
        });
    }
}

/// Flips the edges that the greedy order of `acyclic` reports, so the ranking graph has no cycle.
fn break_cycles(edges: &mut [RankingEdge]) {
    let arcs: Vec<(usize, usize)> = edges.iter().map(|e| (e.from, e.to)).collect();
    for i in reversed_arcs(&arcs) {
        let e = &mut edges[i];
        std::mem::swap(&mut e.from, &mut e.to);
        e.reversed = !e.reversed;
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
#[derive(Debug, Clone, PartialEq)]
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
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Layers {
    pub(crate) bundles: Vec<Bundle>,
    pub(crate) dummies: Vec<DummyKey>,
}

/// Lays the graph out in ranks: one bundle per kind and ordered pair of nodes, with a dummy chain across each rank the
/// bundle spans. Self-loops and edges with unknown ends take no part. Bundles are in order of their first edge.
pub(crate) fn layer(graph: &Indexed, edges: &[EdgeRule], ranks: &[f64]) -> Layers {
    let mut out = Layers {
        bundles: Vec::new(),
        dummies: Vec::new(),
    };
    for members in group_bundles(graph, edges) {
        add_bundle(graph, &mut out, edges, ranks, &members);
    }
    out
}

/// The non-self-loop edges, grouped by kind and ordered pair of nodes, in order of first appearance.
fn group_bundles(graph: &Indexed, edges: &[EdgeRule]) -> Vec<Vec<usize>> {
    let mut index: BTreeMap<(usize, usize, usize), usize> = BTreeMap::new();
    let mut groups: Vec<Vec<usize>> = Vec::new();
    for (id, rule) in edges.iter().enumerate() {
        let Some((source, target)) = graph.ends(id) else {
            continue;
        };
        let (source, target) = (source as usize, target as usize);
        if source == target {
            continue;
        }
        let key = (rule.kind, source, target);
        if let Some(&g) = index.get(&key) {
            groups[g].push(id);
        } else {
            index.insert(key, groups.len());
            groups.push(vec![id]);
        }
    }
    groups
}

/// Adds the bundle of one group of parallel edges and, unless it is flat, the dummy chain that carries it.
fn add_bundle(
    graph: &Indexed,
    out: &mut Layers,
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
    let mut bundle = Bundle {
        kind: edges[first].kind,
        source,
        target,
        edges: members.to_vec(),
        chain: Vec::new(),
        reversed,
        flat,
        weight: edges[first].weight * f64::from(count).sqrt(),
    };
    if flat {
        bundle.chain = vec![ChainNode::Node(upper), ChainNode::Node(lower)];
    } else {
        let mut chain = vec![ChainNode::Node(upper)];
        let mut r = ranks[upper] + 1.0;
        while r < ranks[lower] {
            out.dummies.push(DummyKey {
                owner: first,
                rank: r,
                position: chain.len(),
            });
            chain.push(ChainNode::Dummy(out.dummies.len() - 1));
            r += 1.0;
        }
        chain.push(ChainNode::Node(lower));
        bundle.chain = chain;
    }
    out.bundles.push(bundle);
}
