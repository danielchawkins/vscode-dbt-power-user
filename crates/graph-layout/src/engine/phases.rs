//! The phases run on a model graph, in the order `runPhases` runs them (`packages/graph-layout/src/phases.ts`): `index`,
//! then rank and layering, then order. This is the glue of those phases up to ordering, written as plain Rust data.
//! Place and route do not run here. Order runs without restarts, which come in a later step.
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
use crate::index::Indexed;
use crate::layering::{
    EdgeRule, LayeredGraph, PartitionMode, RankError, RankOptions, Scratch, layer, rank,
};
use crate::model::{Graph, Options, Partitions};
use crate::order::{Hints, order};

/// Two to the 32nd, the modulus of the 32-bit seed and the range of a rank.
const TWO_POW_32: f64 = 4_294_967_296.0;

/// What the phases produced: the rank of each node, the layered graph and the order of each rank.
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
}

/// Why the phases did not run on a graph.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PhaseError {
    /// The effort names no budget: it is not `fast`, `balanced` or `thorough`. The name is given as it was.
    UnknownEffort(String),
    /// A lateral port has a dummy in the layered graph, which ordering does not handle yet.
    LateralPort,
    /// A rank is not a whole number below 2^32, as a fractional minimum length gives.
    NonIntegerRank,
    /// Ranking failed. The constraints of a validated graph never cause this.
    Ranking(RankError),
}

/// Runs index, rank, layering and order on `graph` with `options`, and returns what they produced. The result is a pure
/// function of the graph and the options. The graph is not validated here: `validate` refuses what the phases cannot
/// lay out.
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
    Ok(Phases {
        ranks,
        reversed: ranking.reversed,
        layered,
        layers: ordered.layers,
        crossings: ordered.crossings,
    })
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
