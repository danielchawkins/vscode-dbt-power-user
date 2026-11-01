//! The cache keys of the stages (ADR 0011, "Live tuning"). A stage's key is FNV-1a 64 over the canonical bytes of the key
//! of the stage before it and of what the stage reads. Two runs whose keys agree at a stage had the same inputs to that
//! stage and to every stage before it, so the stage's output can be reused.
//!
//! The index stage reads the whole graph, so a change to the graph changes the first key, and with it every key after
//! it. The later stages read the graph only through the index. An option is written by the stages that read it, in the
//! form the code reads it: a field that is left out takes its default, so it keys as that default. `spacing` is written
//! as `spacing_of` resolves it, except where the stage reads the raw field (`build`, which reads it before the default).

use crate::budget::Budget;
use crate::hash::Fnv64;
use crate::model::{Direction, Graph, Hints, Options, Partitions, Ranks};

use super::phases::{spacing_of, to_uint32};

#[cfg(test)]
mod tests;

/// A stage of the layout, in the order the phases run: the index, then rank and layer, build, order, place and route.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stage {
    /// The dense view of the graph: the ids, the ends of each edge, and the components the edges' joins make.
    Index,
    /// The ranks of the nodes, and the rule of each edge that ranking and the later stages read.
    Rank,
    /// The bundles of the edges: the dummies of the layers.
    Layer,
    /// The layered graph: the real nodes, and the dummies of the bundles and spines.
    Build,
    /// The order of each rank.
    Order,
    /// The placement of the layered graph.
    Place,
    /// The polylines of the edges through the placement.
    Route,
}

impl Stage {
    /// Every stage, in the order the phases run.
    pub const ALL: [Self; 7] = [
        Self::Index,
        Self::Rank,
        Self::Layer,
        Self::Build,
        Self::Order,
        Self::Place,
        Self::Route,
    ];

    /// The number of stages, which is the length of `ALL`.
    pub(super) const COUNT: usize = 7;

    /// The place of this stage in `ALL`.
    pub(super) const fn position(self) -> usize {
        match self {
            Self::Index => 0,
            Self::Rank => 1,
            Self::Layer => 2,
            Self::Build => 3,
            Self::Order => 4,
            Self::Place => 5,
            Self::Route => 6,
        }
    }
}

/// The key of each stage, by [`Stage::position`].
pub(super) fn stage_keys(graph: &Graph, options: &Options, budget: &Budget) -> [u64; Stage::COUNT] {
    let index = keyed(0, |h| index_reads(h, graph, options));
    let rank = keyed(index, |h| rank_reads(h, graph, options, budget));
    let layer = keyed(rank, |h| layer_reads(h, graph, options));
    let build = keyed(layer, |h| build_reads(h, options));
    let order = keyed(build, |h| order_reads(h, options, budget));
    let place = keyed(order, |h| place_reads(h, options, budget));
    let route = keyed(place, |h| route_reads(h, graph, options, budget));
    [index, rank, layer, build, order, place, route]
}

/// The key of a stage: the previous stage's key, then what the stage reads.
fn keyed(previous: u64, reads: impl FnOnce(&mut Fnv64)) -> u64 {
    let mut h = Fnv64::new();
    h.write(&previous.to_le_bytes());
    reads(&mut h);
    h.finish()
}

/// `index` reads the graph and, for each edge, whether its kind has a policy and what the policy says about ranking and
/// routing: `policy_joins` is the only use.
fn index_reads(h: &mut Fnv64, graph: &Graph, options: &Options) {
    write_graph(h, graph);
    for kind in &graph.edges.kind {
        let policy = options.edge_kinds.get(kind);
        write_bool(h, policy.is_some());
        write_bool(h, policy.is_some_and(|p| p.ranks));
        write_opt(h, policy.and_then(|p| p.routed), write_bool);
    }
}

/// `rank` reads the direction (the lateral ports of each rule), the partition mode, the stability, the hinted ranks and
/// the rank pivots. Each kind's rule carries its minimum length and weight only when it ranks.
fn rank_reads(h: &mut Fnv64, graph: &Graph, options: &Options, budget: &Budget) {
    write_direction(h, options.direction);
    write_partitions(h, options.partitions.unwrap_or_default());
    h.write_f64(options.stability.unwrap_or(1.0));
    for kind in &graph.edges.kind {
        let policy = options.edge_kinds.get(kind);
        let ranks = policy.is_some_and(|p| p.ranks);
        write_bool(h, ranks);
        if ranks {
            h.write_f64(policy.and_then(|p| p.min_length).unwrap_or(1.0));
            h.write_f64(policy.and_then(|p| p.weight).unwrap_or(1.0));
        }
    }
    write_hints(h, options.hints.as_ref(), |h, hints| {
        write_seq(h, &hints.id, |h, id: &String| write_str(h, id));
        write_seq(h, &hints.rank, |h, &rank| h.write_u32(rank));
    });
    write_len(h, budget.rank_pivots);
}

/// `layer` reads each kind's weight, which every bundle carries, and whether it ranks.
fn layer_reads(h: &mut Fnv64, graph: &Graph, options: &Options) {
    for kind in &graph.edges.kind {
        let policy = options.edge_kinds.get(kind);
        write_bool(h, policy.is_some_and(|p| p.ranks));
        h.write_f64(policy.and_then(|p| p.weight).unwrap_or(1.0));
    }
}

/// `build` reads the direction (the sides of the layered graph) and the raw edge spacing, before its default.
fn build_reads(h: &mut Fnv64, options: &Options) {
    write_direction(h, options.direction);
    write_opt(h, options.spacing.and_then(|s| s.edge), |h, edge| {
        h.write_f64(edge);
    });
}

/// `order` reads the seed as `to_uint32` takes it, the hinted orders, and the five sweep and restart counts.
fn order_reads(h: &mut Fnv64, options: &Options, budget: &Budget) {
    h.write_u32(to_uint32(options.seed.unwrap_or(0.0)));
    write_hints(h, options.hints.as_ref(), |h, hints| {
        write_seq(h, &hints.id, |h, id: &String| write_str(h, id));
        write_seq(h, &hints.order, |h, &order| h.write_u32(order));
    });
    write_len(h, budget.sweeps);
    write_len(h, budget.sift_rounds);
    write_len(h, budget.dummy_sift_rounds);
    write_len(h, budget.hinted_dummy_sift_rounds);
    write_len(h, budget.restarts);
}

/// `place` reads the direction, the across mode, the stability, the anchor, the resolved spacing, the hinted corners and
/// the placement iterations.
fn place_reads(h: &mut Fnv64, options: &Options, budget: &Budget) {
    write_direction(h, options.direction);
    write_mode(h, options.ranks.unwrap_or_default());
    h.write_f64(options.stability.unwrap_or(1.0));
    write_opt(h, options.anchor.as_deref(), write_str);
    let spacing = spacing_of(options);
    h.write_f64(spacing.node);
    h.write_f64(spacing.rank);
    h.write_f64(spacing.edge);
    h.write_f64(spacing.cluster);
    write_hints(h, options.hints.as_ref(), |h, hints| {
        write_seq(h, &hints.id, |h, id: &String| write_str(h, id));
        write_seq(h, &hints.x, |h, &x| h.write_f64(x));
        write_seq(h, &hints.y, |h, &y| h.write_f64(y));
    });
    write_len(h, budget.place_iterations);
}

/// `route` reads the direction, the across mode, the resolved edge and rank spacing, whether each kind is routed, and
/// the route pairs.
fn route_reads(h: &mut Fnv64, graph: &Graph, options: &Options, budget: &Budget) {
    write_direction(h, options.direction);
    write_mode(h, options.ranks.unwrap_or_default());
    let spacing = spacing_of(options);
    h.write_f64(spacing.edge);
    h.write_f64(spacing.rank);
    for kind in &graph.edges.kind {
        let routed = options
            .edge_kinds
            .get(kind)
            .and_then(|p| p.routed)
            .unwrap_or(true);
        write_bool(h, routed);
    }
    write_len(h, budget.route_pairs);
}

/// The graph, field by field, with each column's length: the canonical bytes that the index stage keys.
fn write_graph(h: &mut Fnv64, graph: &Graph) {
    let nodes = &graph.nodes;
    write_seq(h, &nodes.id, |h, id| write_str(h, id));
    write_seq(h, &nodes.width, |h, &w| h.write_f64(w));
    write_seq(h, &nodes.height, |h, &v| h.write_f64(v));
    write_seq(h, &nodes.cluster, |h, c| {
        write_opt(h, c.as_deref(), write_str);
    });
    write_seq(h, &nodes.partition, |h, &p| {
        write_opt(h, p, Fnv64::write_f64);
    });
    let ports = &nodes.ports;
    write_seq(h, &ports.node, |h, &n| h.write_u32(n));
    write_seq(h, &ports.id, |h, id| write_str(h, id));
    write_seq(h, &ports.side, |h, side| write_str(h, side));
    write_seq(h, &ports.offset, |h, &o| h.write_f64(o));
    let edges = &graph.edges;
    write_seq(h, &edges.id, |h, id| write_str(h, id));
    write_seq(h, &edges.source, |h, s| write_str(h, s));
    write_seq(h, &edges.target, |h, t| write_str(h, t));
    write_seq(h, &edges.source_port, |h, p| {
        write_opt(h, p.as_deref(), write_str);
    });
    write_seq(h, &edges.target_port, |h, p| {
        write_opt(h, p.as_deref(), write_str);
    });
    write_seq(h, &edges.kind, |h, k| write_str(h, k));
    let clusters = &graph.clusters;
    write_seq(h, &clusters.id, |h, id| write_str(h, id));
    write_seq(h, &clusters.parent, |h, p| {
        write_opt(h, p.as_deref(), write_str);
    });
    write_seq(h, &clusters.padding, |h, &p| {
        write_opt(h, p, Fnv64::write_f64);
    });
    write_seq(h, &clusters.label_height, |h, &p| {
        write_opt(h, p, Fnv64::write_f64);
    });
    write_seq(h, &clusters.opaque, |h, &o| {
        write_opt(h, o, write_bool);
    });
}

/// The hints, as presence and then what the stage reads from them.
fn write_hints(h: &mut Fnv64, hints: Option<&Hints>, reads: impl FnOnce(&mut Fnv64, &Hints)) {
    write_opt(h, hints, reads);
}

fn write_direction(h: &mut Fnv64, direction: Direction) {
    h.write(&[match direction {
        Direction::Down => 0,
        Direction::Right => 1,
    }]);
}

fn write_partitions(h: &mut Fnv64, partitions: Partitions) {
    h.write(&[match partitions {
        Partitions::None => 0,
        Partitions::Soft => 1,
        Partitions::Strict => 2,
    }]);
}

fn write_mode(h: &mut Fnv64, ranks: Ranks) {
    h.write(&[match ranks {
        Ranks::Rows => 0,
        Ranks::Levels => 1,
    }]);
}

/// A length, as eight little-endian bytes, so a sequence of strings cannot run into the next field.
fn write_len(h: &mut Fnv64, len: usize) {
    h.write(&u64::try_from(len).unwrap_or(u64::MAX).to_le_bytes());
}

fn write_bool(h: &mut Fnv64, value: bool) {
    h.write(&[u8::from(value)]);
}

fn write_str(h: &mut Fnv64, value: &str) {
    write_len(h, value.len());
    h.write(value.as_bytes());
}

/// An option: a tag byte (0 for none, 1 for some), then the value when there is one.
fn write_opt<T>(h: &mut Fnv64, value: Option<T>, write: impl FnOnce(&mut Fnv64, T)) {
    if let Some(value) = value {
        h.write(&[1]);
        write(h, value);
    } else {
        h.write(&[0]);
    }
}

/// A sequence: its length, then each item.
fn write_seq<T>(h: &mut Fnv64, items: &[T], write: impl Fn(&mut Fnv64, &T)) {
    write_len(h, items.len());
    for item in items {
        write(h, item);
    }
}
