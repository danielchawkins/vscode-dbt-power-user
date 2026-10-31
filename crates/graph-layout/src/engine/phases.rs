//! The phases run on a model graph, in the order `runPhases` runs them (`packages/graph-layout/src/phases.ts`): `index`,
//! then rank and layering, then order, then place. This is the glue of those phases up to placement, written as plain
//! Rust data. Route does not run here. Order runs without restarts, which come in a later step.
//!
//! Three things are refused rather than run, because the ported phases do not handle them yet. A lateral port needs
//! the lateral blocks of ordering, which are not ported. A rank that is not a whole number needs a fractional minimum
//! length, which the layered graph (`usize` ranks) cannot hold. An effort that names no budget has no counts. Opaque
//! clusters are not yet kept apart by `keepOutside`: ordering returns its layers unchanged, as `order/mod.rs` says.

#[cfg(test)]
mod tests;

use std::collections::BTreeMap;

use super::layered::build;
use crate::budget::Budget;
use crate::constraints::components;
use crate::index::Indexed;
use crate::layering::{
    EdgeRule, LayeredGraph, Layers, PartitionMode, RankError, RankOptions, Scratch, layer, rank,
};
use crate::model::{Direction, Graph, Options, Partitions, Ranks};
use crate::order::{Hints, order};
use crate::place::{
    ClusterSpec, Hint, Layered, LayeredNode, LinkOptions, Mode, PlaceInput, Placement, Segment,
    Spacing, place, problem_of,
};

/// Two to the 32nd, the modulus of the 32-bit seed and the range of a rank.
const TWO_POW_32: f64 = 4_294_967_296.0;

/// What the phases produced: the rank of each node, the layered graph, the order of each rank and the placement.
#[derive(Debug, Clone, PartialEq)]
pub struct Phases {
    /// The rank of each node, by node index. The lowest real node is at rank 0.
    pub ranks: Vec<usize>,
    /// The indices of the ranking edges that are laid out against their direction, in edge order.
    pub reversed: Vec<usize>,
    /// The layered graph: the real nodes, then the dummies of the bundles and spines.
    pub layered: LayeredGraph,
    /// The order of each rank, left to right, as indices into `layered.nodes`, dummies included.
    pub layers: Vec<Vec<usize>>,
    /// The weighted crossings of `layers`.
    pub crossings: f64,
    /// The placement: each layered node's point, each rank's centre across the drawing, and the box plan that route
    /// reads through `place::boxes`.
    pub placement: Placement,
}

/// Why the phases did not run on a graph.
#[derive(Debug, Clone, PartialEq)]
pub enum PhaseError {
    /// The effort names no budget: it is not `fast`, `balanced` or `thorough`. The name is given as it was.
    UnknownEffort(String),
    /// A lateral port has a dummy in the layered graph, which ordering does not handle yet.
    LateralPort,
    /// A rank is not a whole number below 2^32, as a fractional minimum length gives.
    NonIntegerRank,
    /// Ranking failed. The constraints of a validated graph never cause this.
    Ranking(RankError),
    /// Placing failed: the in-rank or the across solve rejected its problem, with the solver's message. The constraints
    /// of a validated graph never cause this.
    Placing(String),
}

/// Runs index, rank, layering, order and place on `graph` with `options`, and returns what they produced. The result is a
/// pure function of the graph and the options. The graph is not validated here: `validate` refuses what the phases
/// cannot lay out.
///
/// # Errors
///
/// Returns the reason the phases do not run on this input: see [`PhaseError`].
pub fn run_phases(graph: &Graph, options: &Options) -> Result<Phases, PhaseError> {
    let budget = Budget::for_effort(options.effort.as_deref())
        .ok_or_else(|| PhaseError::UnknownEffort(options.effort.clone().unwrap_or_default()))?;
    let index = Indexed::new(graph, Some(options));
    let rules = edge_rules(graph, options);
    let (hint_ranks, hint_orders) = hints(graph, &index, options);
    let rank_options = RankOptions {
        partitions: partition_mode(options.partitions.unwrap_or_default()),
        node_partition: &graph.nodes.partition,
        edges: &rules,
        hints: &hint_ranks,
        stability: options.stability.unwrap_or(1.0),
        budget: &budget,
    };
    let ranking =
        rank(&index, &rank_options, &mut Scratch::default()).map_err(PhaseError::Ranking)?;
    let ranks = ranking
        .ranks
        .iter()
        .map(|&r| whole_rank(r))
        .collect::<Option<Vec<usize>>>()
        .ok_or(PhaseError::NonIntegerRank)?;
    let layers = layer(&index, &rules, &ranking.ranks);
    let layered = build(graph, options, &layers, &ranks);
    if layered.nodes.iter().any(|node| node.port.is_some()) {
        return Err(PhaseError::LateralPort);
    }
    // Restarts come in a later step, so ordering runs its first search only.
    let without_restarts = Budget {
        restarts: 0,
        ..budget
    };
    let seed = to_uint32(options.seed.unwrap_or(0.0));
    let ordered = order(&layered, hint_orders.as_ref(), &without_restarts, seed);
    let placement = place_layout(
        &PlaceGlue {
            graph,
            index: &index,
            options,
            rules: &rules,
            bundles: &layers,
        },
        &layered,
        &ordered.layers,
        budget.place_iterations,
    )?;
    Ok(Phases {
        ranks,
        reversed: ranking.reversed,
        layered,
        layers: ordered.layers,
        crossings: ordered.crossings,
        placement,
    })
}

/// What the placement reads from the run: the graph and its indexed ids, the options, each edge's rule, and the bundles
/// of layering that the segments of the layered graph come from.
struct PlaceGlue<'a> {
    graph: &'a Graph,
    index: &'a Indexed,
    options: &'a Options,
    rules: &'a [EdgeRule],
    bundles: &'a Layers,
}

/// The placement of the ordered layered graph, as `place` in `packages/graph-layout/src/place/index.ts` runs it: the
/// in-rank problem of the layered graph, the box plan of the clusters, and the across axis under the rows or the
/// levels. `iterations` is the in-rank solve's budget (`Budget::place_iterations`).
fn place_layout(
    glue: &PlaceGlue<'_>,
    layered: &LayeredGraph,
    layers: &[Vec<usize>],
    iterations: usize,
) -> Result<Placement, PhaseError> {
    let options = glue.options;
    let graph = glue.graph;
    let down = options.direction == Direction::Down;
    let spacing = spacing_of(options);
    let ids: Vec<Option<&str>> = layered
        .nodes
        .iter()
        .map(|node| node.id.map(|n| graph.nodes.id[n].as_str()))
        .collect();
    let corners = hint_corners(options);
    let hints: Vec<Option<Hint>> = ids
        .iter()
        .map(|id| id.and_then(|id| corners.get(id).copied()))
        .collect();
    let nodes: Vec<LayeredNode<'_>> = layered
        .nodes
        .iter()
        .enumerate()
        .map(|(i, node)| LayeredNode {
            id: ids[i],
            breadth: node.breadth,
            block: layered.block[i],
            // Lateral ports are refused before placement, so a node is anchored exactly when it is real.
            anchored: node.id.is_some(),
            hint: hints[i],
        })
        .collect();
    let directed = directed_bundles(glue, layered.nodes.len());
    let segments: Vec<Segment> = layered
        .segments
        .iter()
        .map(|segment| Segment {
            top: segment.top,
            bottom: segment.bottom,
            weight: segment.weight,
            top_offset: segment.top_offset,
            bottom_offset: segment.bottom_offset,
            directed: directed[segment.bundle],
        })
        .collect();
    let stability = options.stability.unwrap_or(1.0);
    let problem = problem_of(
        &Layered {
            layers,
            nodes: &nodes,
            segments: &segments,
            spines: &layered.spines,
        },
        &LinkOptions {
            anchor: options.anchor.as_deref(),
            stability,
            down,
            spacing_node: spacing.node,
            spacing_edge: spacing.edge,
        },
    );
    let node_ranks: Vec<usize> = layered.nodes.iter().map(|node| node.rank).collect();
    let in_rank_half: Vec<f64> = layered
        .nodes
        .iter()
        .map(|node| node.breadth / 2.0)
        .collect();
    // The extent across the ranks is the height going down and the width going right; a dummy has none.
    let across_extent: Vec<f64> = layered
        .nodes
        .iter()
        .map(|node| {
            node.id.map_or(0.0, |n| {
                if down {
                    graph.nodes.height[n]
                } else {
                    graph.nodes.width[n]
                }
            })
        })
        .collect();
    let mode = match options.ranks.unwrap_or_default() {
        Ranks::Rows => Mode::Rows,
        Ranks::Levels => Mode::Levels,
    };
    place(&PlaceInput {
        problem: &problem,
        ranks: layered.ranks,
        node_ranks: &node_ranks,
        segments: &segments,
        paths: &layered.paths,
        clusters: &cluster_specs(graph),
        in_rank_half: &in_rank_half,
        across_extent: &across_extent,
        ids: &ids,
        hints: &hints,
        anchor: options.anchor.as_deref(),
        down,
        spacing,
        iterations,
        mode,
        stability,
    })
    .map_err(|error| PhaseError::Placing(error.to_string()))
}

/// The spacing of the run: each field the options leave out takes the circuit preset's value, as `place` takes it.
fn spacing_of(options: &Options) -> Spacing {
    let given = options.spacing.unwrap_or_default();
    Spacing {
        node: given.node.unwrap_or(12.0),
        rank: given.rank.unwrap_or(28.0),
        edge: given.edge.unwrap_or(4.0),
        cluster: given.cluster.unwrap_or(12.0),
    }
}

/// The previous top-left corner of each hinted node, by id. A hint for an id that is not a node is kept but never read.
/// When an id is named twice, the later row wins.
fn hint_corners(options: &Options) -> BTreeMap<&str, Hint> {
    let Some(hints) = &options.hints else {
        return BTreeMap::new();
    };
    hints
        .id
        .iter()
        .zip(&hints.x)
        .zip(&hints.y)
        .map(|((id, &x), &y)| (id.as_str(), Hint { x, y }))
        .collect()
}

/// The clusters the box plan reads, by index: each one's parent as an index into the same list, when it names one. A
/// cluster with no padding or label height in its column takes none, as an unset field does in TypeScript.
fn cluster_specs(graph: &Graph) -> Vec<ClusterSpec> {
    let clusters = &graph.clusters;
    clusters
        .id
        .iter()
        .enumerate()
        .map(|(c, id)| ClusterSpec {
            id: id.clone(),
            parent: clusters
                .parent
                .get(c)
                .and_then(Option::as_ref)
                .and_then(|parent| clusters.id.iter().position(|x| x == parent)),
            padding: clusters.padding.get(c).copied().flatten(),
            label_height: clusters.label_height.get(c).copied().flatten(),
        })
        .collect()
}

/// Which bundles constrain the across axis, by bundle index (`directedBundles` in `place/levelNodes.ts`): a bundle of a
/// kind that ranks, whose ends are not in one strongly connected component of the ranking graph. A cycle's edges are
/// reversed by the ranking, so they carry no direction.
fn directed_bundles(glue: &PlaceGlue<'_>, node_count: usize) -> Vec<bool> {
    let node = |id: &str| glue.index.node(id).and_then(|n| usize::try_from(n).ok());
    let mut edges = Vec::new();
    for ((source, target), rule) in glue
        .graph
        .edges
        .source
        .iter()
        .zip(&glue.graph.edges.target)
        .zip(glue.rules)
    {
        if let (true, Some(from), Some(to)) = (rule.ranks, node(source), node(target)) {
            edges.push((from, to));
        }
    }
    let comp = components(node_count, &edges);
    glue.bundles
        .bundles
        .iter()
        .map(|bundle| {
            glue.rules[bundle.edges[0]].ranks && comp[bundle.source] != comp[bundle.target]
        })
        .collect()
}

/// The rule of each edge, by edge index: the dense id of its kind (numbered in order of first appearance), and its
/// policy. A kind with no policy does not rank and has the default minimum length and weight of `rank/index.ts`.
fn edge_rules(graph: &Graph, options: &Options) -> Vec<EdgeRule> {
    let mut kinds: BTreeMap<&str, usize> = BTreeMap::new();
    graph
        .edges
        .kind
        .iter()
        .map(|kind| {
            let next = kinds.len();
            let kind_id = *kinds.entry(kind.as_str()).or_insert(next);
            let policy = options.edge_kinds.get(kind);
            EdgeRule {
                kind: kind_id,
                ranks: policy.is_some_and(|p| p.ranks),
                min_length: policy.and_then(|p| p.min_length).unwrap_or(1.0),
                weight: policy.and_then(|p| p.weight).unwrap_or(1.0),
            }
        })
        .collect()
}

/// The hints the phases read: the hinted rank of each node, by node index (empty when the run has no hints), and the
/// hinted in-rank order of each node, by node index. A hint for an id that is not a node is ignored.
fn hints(graph: &Graph, index: &Indexed, options: &Options) -> (Vec<Option<u32>>, Option<Hints>) {
    let Some(hints) = &options.hints else {
        return (Vec::new(), None);
    };
    let mut ranks = vec![None; graph.nodes.id.len()];
    let mut orders = Hints::new();
    for ((id, &hinted_rank), &hinted_order) in hints.id.iter().zip(&hints.rank).zip(&hints.order) {
        let Some(node) = index.node(id).and_then(|n| usize::try_from(n).ok()) else {
            continue;
        };
        ranks[node] = Some(hinted_rank);
        orders.insert(node, f64::from(hinted_order));
    }
    (ranks, Some(orders))
}

fn partition_mode(partitions: Partitions) -> PartitionMode {
    match partitions {
        Partitions::None => PartitionMode::None,
        Partitions::Soft => PartitionMode::Soft,
        Partitions::Strict => PartitionMode::Strict,
    }
}

/// The rank `r` as a whole number, when it is one below 2^32 (`None` for a fraction, a negative value or a value too
/// large for a rank).
fn whole_rank(r: f64) -> Option<usize> {
    if r.fract().abs() > 0.0 || !(0.0..TWO_POW_32).contains(&r) {
        return None;
    }
    usize::try_from(to_uint32(r)).ok()
}

/// `x >>> 0`, as the TypeScript engine reads a seed: `x` truncated and reduced modulo 2^32, and 0 when `x` is not
/// finite. The bits are taken one at a time, since the core denies float-to-integer casts.
fn to_uint32(x: f64) -> u32 {
    if !x.is_finite() {
        return 0;
    }
    let mut rest = x.trunc().rem_euclid(TWO_POW_32);
    let mut out = 0_u32;
    for bit in (0..u32::BITS).rev() {
        let weight = f64::from(1_u32 << bit);
        if rest >= weight {
            rest -= weight;
            out |= 1 << bit;
        }
    }
    out
}
