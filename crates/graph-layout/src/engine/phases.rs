//! The phases run on a model graph, in the order `runPhases` runs them (`packages/graph-layout/src/phases.ts`): `index`,
//! then rank and layering, then order, then place, then route (`routing`). This is the glue of those phases, written as
//! plain Rust data. Order runs without restarts, which come in a later step.
//!
//! Two things are refused rather than run. A rank that is not a whole number needs a fractional minimum length, which
//! the layered graph (`usize` ranks) cannot hold. An effort that names no budget has no counts. Lateral ports run:
//! their dummies are ordered as units with their owners, and routed as stubs. Opaque clusters are not yet kept apart by
//! `keepOutside`: ordering returns its layers unchanged, as `order/mod.rs` says, and routing flags what breaches.

mod routing;
#[cfg(test)]
pub(super) mod tests;

use std::collections::BTreeMap;
use std::sync::Arc;

use super::keys::{Stage, stage_keys};
use super::layered::build;
use crate::budget::Budget;
use crate::constraints::components;
use crate::index::Indexed;
use crate::layering::{
    EdgeRule, LayeredGraph, Layers, PartitionMode, RankError, RankOptions, Scratch, layer, rank,
};
use crate::model::{Direction, Graph, Options, Partitions, Ranks};
use crate::order::{Hints, Ordered, order};
use crate::place::{
    ClusterSpec, Hint, Layered, LayeredNode, LinkOptions, Mode, PlaceInput, Placement, Segment,
    Spacing, place, problem_of,
};
use crate::route::Routing;
use routing::route_layout;

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
    /// The routing: the polyline of each edge, the re-stacked ranks and the cluster boxes that route reads, with what it
    /// did. Under `ranks: "levels"` the levels route draws each run between its two ends, and an edge it cannot draw is
    /// `RouteFailed`.
    pub routing: Routing,
}

/// Why the phases did not run on a graph.
#[derive(Debug, Clone, PartialEq)]
pub enum PhaseError {
    /// The effort names no budget: it is not `fast`, `balanced` or `thorough`. The name is given as it was.
    UnknownEffort(String),
    /// A rank is not a whole number below 2^32, as a fractional minimum length gives.
    NonIntegerRank,
    /// Ranking failed. The constraints of a validated graph never cause this.
    Ranking(RankError),
    /// Placing failed: the in-rank or the across solve rejected its problem, with the solver's message. The constraints
    /// of a validated graph never cause this.
    Placing(String),
}

/// What the rank stage produced: each node's rank as a whole number, the ranks as ranking measured them (which layering
/// reads), the ranking edges laid out against their direction, and the rule of each edge (which layering and placement
/// read).
#[derive(Debug, Clone, PartialEq)]
struct Ranking {
    ranks: Vec<usize>,
    measured: Vec<f64>,
    reversed: Vec<usize>,
    rules: Vec<EdgeRule>,
}

/// The outputs of the seven stages of one run, each behind an `Arc`, so a run that reuses a stage shares its output
/// instead of copying it. `keys` is the key each stage was computed under (see `engine::keys`).
#[derive(Debug, Clone)]
pub(super) struct Stages {
    keys: [u64; Stage::COUNT],
    index: Arc<Indexed>,
    ranking: Arc<Ranking>,
    layers: Arc<Layers>,
    layered: Arc<LayeredGraph>,
    ordered: Arc<Ordered>,
    placement: Arc<Placement>,
    routing: Arc<Routing>,
}

/// The outputs that `assemble` reads, by reference: the view of a run's `Stages`, which needs no copy.
pub(super) struct PhasesRef<'a> {
    pub(super) reversed: &'a [usize],
    pub(super) layered: &'a LayeredGraph,
    pub(super) layers: &'a [Vec<usize>],
    pub(super) routing: &'a Routing,
}

impl Stages {
    /// The outputs of this run, by reference.
    pub(super) fn view(&self) -> PhasesRef<'_> {
        PhasesRef {
            reversed: &self.ranking.reversed,
            layered: &self.layered,
            layers: &self.ordered.layers,
            routing: &self.routing,
        }
    }

    /// The phases as `run_phases` returns them. Each output is moved out of its `Arc`, which copies only a stage that a
    /// second owner still shares.
    fn into_phases(self) -> Phases {
        let ranking = Arc::unwrap_or_clone(self.ranking);
        let ordered = Arc::unwrap_or_clone(self.ordered);
        Phases {
            ranks: ranking.ranks,
            reversed: ranking.reversed,
            layered: Arc::unwrap_or_clone(self.layered),
            layers: ordered.layers,
            crossings: ordered.crossings,
            placement: Arc::unwrap_or_clone(self.placement),
            routing: Arc::unwrap_or_clone(self.routing),
        }
    }
}

/// Runs index, rank, layering, build, order, place and route on `graph` with `options`, and returns what they produced.
/// The result is a pure function of the graph and the options. The graph is not validated here: `validate` refuses what
/// the phases cannot lay out.
///
/// # Errors
///
/// Returns the reason the phases do not run on this input: see [`PhaseError`].
pub fn run_phases(graph: &Graph, options: &Options) -> Result<Phases, PhaseError> {
    let Some(run) = run_stages(graph, options, None, &|| true)? else {
        unreachable!("a run that is never superseded completes")
    };
    Ok(run.stages.into_phases())
}

/// What a run produced: its stages, and the stages it ran again. The other stages came from the prior run.
#[derive(Debug)]
pub(super) struct Run {
    pub(super) stages: Stages,
    pub(super) reran: Vec<Stage>,
}

/// Runs, from the first stage whose key differs from `prior`'s, every stage that the prior run cannot supply, and returns
/// the stages with their outputs. Without a prior run, every stage runs. `current` is asked before each stage that runs
/// and once more before the outputs are kept: once it answers `false`, the run is superseded and returns `None`.
///
/// # Errors
///
/// Returns the reason the phases do not run on this input: see [`PhaseError`].
pub(super) fn run_stages(
    graph: &Graph,
    options: &Options,
    prior: Option<&Stages>,
    current: &dyn Fn() -> bool,
) -> Result<Option<Run>, PhaseError> {
    let budget = budget_of(options)?;
    let keys = stage_keys(graph, options, &budget);
    let reused = prior.map_or(0, |p| {
        (0..Stage::COUNT)
            .take_while(|&i| p.keys[i] == keys[i])
            .count()
    });
    let mut step = Step {
        prior,
        reused,
        current,
        reran: Vec::new(),
    };

    let Some(index) = step.output(
        Stage::Index,
        |p| &p.index,
        || Ok(index_stage(graph, options)),
    )?
    else {
        return Ok(None);
    };
    let Some(ranking) = step.output(
        Stage::Rank,
        |p| &p.ranking,
        || rank_stage(graph, options, &index, &budget),
    )?
    else {
        return Ok(None);
    };
    let Some(layers) = step.output(
        Stage::Layer,
        |p| &p.layers,
        || Ok(layer_stage(&index, &ranking)),
    )?
    else {
        return Ok(None);
    };
    let Some(layered) = step.output(
        Stage::Build,
        |p| &p.layered,
        || Ok(build_stage(graph, options, &layers, &ranking.ranks)),
    )?
    else {
        return Ok(None);
    };
    let Some(ordered) = step.output(
        Stage::Order,
        |p| &p.ordered,
        || Ok(order_stage(graph, options, &index, &layered, &budget)),
    )?
    else {
        return Ok(None);
    };
    let Some(placement) = step.output(
        Stage::Place,
        |p| &p.placement,
        || {
            place_stage(
                &PlaceGlue {
                    graph,
                    index: &index,
                    options,
                    rules: &ranking.rules,
                    bundles: &layers,
                },
                &layered,
                &ordered.layers,
                budget.place_iterations,
            )
        },
    )?
    else {
        return Ok(None);
    };
    let Some(routing) = step.output(
        Stage::Route,
        |p| &p.routing,
        || {
            Ok(route_stage(
                graph, options, &index, &layers, &layered, &placement, &budget,
            ))
        },
    )?
    else {
        return Ok(None);
    };
    Ok(Some(Run {
        stages: Stages {
            keys,
            index,
            ranking,
            layers,
            layered,
            ordered,
            placement,
            routing,
        },
        reran: step.reran,
    }))
}

/// The state of one run: the prior run whose outputs it may reuse, how many leading stages that run agrees with, the
/// supersession check, and the stages this run has run.
struct Step<'a> {
    prior: Option<&'a Stages>,
    reused: usize,
    current: &'a dyn Fn() -> bool,
    reran: Vec<Stage>,
}

impl Step<'_> {
    /// The output of `stage`: the prior run's when that run agrees with the stage's key, else the output of `make`, once
    /// `current` allows the run on. `None` means the run is superseded.
    fn output<T>(
        &mut self,
        stage: Stage,
        cached: impl FnOnce(&Stages) -> &Arc<T>,
        make: impl FnOnce() -> Result<T, PhaseError>,
    ) -> Result<Option<Arc<T>>, PhaseError> {
        if let Some(prior) = self.prior.filter(|_| stage.position() < self.reused) {
            return Ok(Some(Arc::clone(cached(prior))));
        }
        if !(self.current)() {
            return Ok(None);
        }
        self.reran.push(stage);
        Ok(Some(Arc::new(make()?)))
    }
}

/// The budget of the effort in `options`, or the refusal of an effort that names no budget.
pub(super) fn budget_of(options: &Options) -> Result<Budget, PhaseError> {
    Budget::for_effort(options.effort.as_deref())
        .ok_or_else(|| PhaseError::UnknownEffort(options.effort.clone().unwrap_or_default()))
}

/// The index stage: the indexed graph, from the graph and the options.
fn index_stage(graph: &Graph, options: &Options) -> Indexed {
    Indexed::new(graph, Some(options))
}

/// The rank stage: the rule of each edge, and the ranks and the reversed edges of ranking under `budget`. A rank that is
/// not a whole number is refused.
fn rank_stage(
    graph: &Graph,
    options: &Options,
    index: &Indexed,
    budget: &Budget,
) -> Result<Ranking, PhaseError> {
    let rules = edge_rules(graph, options, index);
    let (hint_ranks, _) = hints(graph, index, options);
    let rank_options = RankOptions {
        partitions: partition_mode(options.partitions.unwrap_or_default()),
        node_partition: &graph.nodes.partition,
        edges: &rules,
        hints: &hint_ranks,
        stability: options.stability.unwrap_or(1.0),
        budget,
    };
    let ranking =
        rank(index, &rank_options, &mut Scratch::default()).map_err(PhaseError::Ranking)?;
    let ranks = ranking
        .ranks
        .iter()
        .map(|&r| whole_rank(r))
        .collect::<Option<Vec<usize>>>()
        .ok_or(PhaseError::NonIntegerRank)?;
    Ok(Ranking {
        ranks,
        measured: ranking.ranks,
        reversed: ranking.reversed,
        rules,
    })
}

/// The layering stage: the bundles of the graph, laid out in the measured ranks.
fn layer_stage(index: &Indexed, ranking: &Ranking) -> Layers {
    layer(index, &ranking.rules, &ranking.measured)
}

/// The build stage: the layered graph of the bundles, at the whole ranks.
fn build_stage(graph: &Graph, options: &Options, layers: &Layers, ranks: &[usize]) -> LayeredGraph {
    build(graph, options, layers, ranks)
}

/// The order stage: the order of each rank, under `budget`, from the seed and the hinted orders.
fn order_stage(
    graph: &Graph,
    options: &Options,
    index: &Indexed,
    layered: &LayeredGraph,
    budget: &Budget,
) -> Ordered {
    let seed = to_uint32(options.seed.unwrap_or(0.0));
    let (_, hint_orders) = hints(graph, index, options);
    order(layered, hint_orders.as_ref(), budget, seed)
}

/// The route stage: the polylines of the edges through the placement, under the route pairs of `budget`.
fn route_stage(
    graph: &Graph,
    options: &Options,
    index: &Indexed,
    layers: &Layers,
    layered: &LayeredGraph,
    placement: &Placement,
    budget: &Budget,
) -> Routing {
    route_layout(
        graph,
        options,
        index,
        layers,
        layered,
        placement,
        budget.route_pairs,
    )
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
fn place_stage(
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
            // A lateral port dummy is not anchored: placement solves its place like any dummy's.
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
pub(super) fn spacing_of(options: &Options) -> Spacing {
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
fn edge_rules(graph: &Graph, options: &Options, index: &Indexed) -> Vec<EdgeRule> {
    let mut kinds: BTreeMap<&str, usize> = BTreeMap::new();
    graph
        .edges
        .kind
        .iter()
        .enumerate()
        .map(|(e, kind)| {
            let next = kinds.len();
            let kind_id = *kinds.entry(kind.as_str()).or_insert(next);
            let policy = options.edge_kinds.get(kind);
            let (source, target) = index
                .ends(e)
                .map_or((0, 0), |(s, t)| (s as usize, t as usize));
            EdgeRule {
                kind: kind_id,
                ranks: policy.is_some_and(|p| p.ranks),
                min_length: policy.and_then(|p| p.min_length).unwrap_or(1.0),
                weight: policy.and_then(|p| p.weight).unwrap_or(1.0),
                ports: [
                    lateral_port(
                        graph,
                        options,
                        source,
                        graph.edges.source_port[e].as_deref(),
                    ),
                    lateral_port(
                        graph,
                        options,
                        target,
                        graph.edges.target_port[e].as_deref(),
                    ),
                ],
            }
        })
        .collect()
}

/// The row of the port `port` names on `node`, when that port sits on a side lateral to the flow: the west and east
/// sides when ranks run down, the north and south sides when they run right. `None` for no port, or a flow-side port.
fn lateral_port(
    graph: &Graph,
    options: &Options,
    node: usize,
    port: Option<&str>,
) -> Option<usize> {
    let port = port?;
    let row = (0..graph.nodes.ports.id.len()).find(|&row| {
        graph.nodes.ports.node[row] as usize == node && graph.nodes.ports.id[row] == port
    })?;
    let side = graph.nodes.ports.side[row].as_str();
    let lateral = match options.direction {
        Direction::Down => ["west", "east"],
        Direction::Right => ["north", "south"],
    };
    lateral.contains(&side).then_some(row)
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
pub(crate) fn to_uint32(x: f64) -> u32 {
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
