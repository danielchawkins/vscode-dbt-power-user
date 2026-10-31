//! Properties of the phases on random graphs, and the refusals of `run_phases`. The checks are the core's own: every rank
//! assignment is valid, each layer is a permutation of its units, dummy chains are contiguous, and the same input gives
//! the same output. The failing seeds of proptest are committed under `proptest-regressions/`.

use std::collections::{BTreeMap, BTreeSet};

use proptest::prelude::*;

use super::{PhaseError, Phases, run_phases, to_uint32, whole_rank};
use crate::layering::LayeredGraph;
use crate::metrics::{Drawing, DrawnPath, Opaque, measure};
use crate::model::{
    Clusters, Direction, EdgeKindPolicy, Edges, Graph, Hints, Nodes, Options, Partitions, Ports,
    Ranks,
};
use crate::route::{EdgeRoute, Point, Rect, breaches, same_coordinate};
use crate::testkit::crossings::brute_crossings;

/// A node number as a float. Test sizes are far below 2^32.
fn f(n: usize) -> f64 {
    f64::from(u32::try_from(n).expect("test sizes fit in u32"))
}

/// The index of the node named `id`.
fn index_of(ids: &[String], id: &str) -> usize {
    ids.iter()
        .position(|x| x == id)
        .expect("an edge names a node")
}

/// Hint rows for the nodes of a graph of `count` nodes: each row names a node by index (taken modulo the count), with
/// a hinted rank and order. A graph with no node takes no rows.
fn hints_of(count: usize, rows: &[(usize, u32, u32)]) -> Hints {
    let rows: &[(usize, u32, u32)] = if count == 0 { &[] } else { rows };
    Hints {
        id: rows
            .iter()
            .map(|&(i, _, _)| format!("n{}", i % count))
            .collect(),
        rank: rows.iter().map(|&(_, rank, _)| rank).collect(),
        order: rows.iter().map(|&(_, _, order)| order).collect(),
        x: vec![0.0; rows.len()],
        y: vec![0.0; rows.len()],
    }
}

/// The edges of a graph of `count` nodes: each raw edge joins two nodes (taken modulo the count) with one of four kinds.
/// Kind 0 ranks with minimum length 1, kind 1 ranks with minimum length 2, kind 2 does not rank, kind 3 has no policy.
fn edges_of(count: usize, raw: &[(usize, usize, usize)]) -> Edges {
    const KINDS: [&str; 4] = ["rank", "stretch", "info", "plain"];
    let pairs: Vec<(usize, usize, usize)> = if count == 0 {
        Vec::new()
    } else {
        raw.iter()
            .map(|&(a, b, k)| (a % count, b % count, k))
            .collect()
    };
    Edges {
        id: (0..pairs.len()).map(|i| format!("e{i}")).collect(),
        source: pairs.iter().map(|p| format!("n{}", p.0)).collect(),
        target: pairs.iter().map(|p| format!("n{}", p.1)).collect(),
        source_port: vec![None; pairs.len()],
        target_port: vec![None; pairs.len()],
        kind: pairs.iter().map(|p| KINDS[p.2].to_owned()).collect(),
    }
}

/// A random graph with its options: up to eight nodes, with partition bands, sizes and clusters; up to 24 edges; and
/// the direction, partition mode, effort, stability, hints and seed of the run.
pub(in crate::engine) fn case() -> impl Strategy<Value = (Graph, Options)> {
    (
        prop::collection::vec(
            (
                prop::option::of(0_u8..3),
                1_u8..=6,
                1_u8..=6,
                prop::option::of(0_u8..2),
            ),
            0..=8,
        ),
        prop::collection::vec((0_usize..64, 0_usize..64, 0_usize..4), 0..24),
        prop::bool::ANY,
        (0_u8..4, 0_u8..3, 0_u8..3),
        prop::option::of(prop::collection::vec(
            (0_usize..64, 0_u32..4, 0_u32..4),
            0..6,
        )),
        prop::option::of(-5_i16..5000),
    )
        .prop_map(
            |(nodes, raw_edges, right, (partitions, effort, stability), hints, seed)| {
                let count = nodes.len();
                let graph = Graph {
                    nodes: Nodes {
                        id: (0..count).map(|i| format!("n{i}")).collect(),
                        width: nodes.iter().map(|n| f64::from(n.1)).collect(),
                        height: nodes.iter().map(|n| f64::from(n.2)).collect(),
                        cluster: nodes.iter().map(|n| n.3.map(|c| format!("c{c}"))).collect(),
                        partition: nodes.iter().map(|n| n.0.map(f64::from)).collect(),
                        ports: Ports::default(),
                    },
                    edges: edges_of(count, &raw_edges),
                    clusters: Clusters {
                        id: vec!["c0".to_owned(), "c1".to_owned()],
                        parent: vec![None, None],
                        ..Clusters::default()
                    },
                };
                let options = Options {
                    direction: if right {
                        Direction::Right
                    } else {
                        Direction::Down
                    },
                    edge_kinds: edge_kinds(),
                    partitions: match partitions {
                        0 => Some(Partitions::None),
                        1 => Some(Partitions::Soft),
                        2 => Some(Partitions::Strict),
                        _ => None,
                    },
                    hints: hints.map(|rows| hints_of(count, &rows)),
                    stability: match stability {
                        1 => Some(0.0),
                        2 => Some(2.0),
                        _ => None,
                    },
                    effort: match effort {
                        0 => Some("fast".to_owned()),
                        1 => Some("balanced".to_owned()),
                        _ => None,
                    },
                    seed: seed.map(f64::from),
                    ..Options::default()
                };
                (graph, options)
            },
        )
}

/// The policies of the kinds `edges_of` uses: `rank` and `stretch` rank, `info` does not, and `plain` has no policy.
fn edge_kinds() -> BTreeMap<String, EdgeKindPolicy> {
    BTreeMap::from([
        (
            "rank".to_owned(),
            EdgeKindPolicy {
                ranks: true,
                min_length: Some(1.0),
                weight: Some(1.0),
                ..EdgeKindPolicy::default()
            },
        ),
        (
            "stretch".to_owned(),
            EdgeKindPolicy {
                ranks: true,
                min_length: Some(2.0),
                weight: Some(2.0),
                ..EdgeKindPolicy::default()
            },
        ),
        (
            "info".to_owned(),
            EdgeKindPolicy {
                ranks: false,
                ..EdgeKindPolicy::default()
            },
        ),
    ])
}

/// Every ranking edge spans its minimum length in the direction it is laid out, and a reversed edge is one that ranks.
fn assert_ranks_valid(graph: &Graph, options: &Options, phases: &Phases) {
    assert_eq!(phases.ranks.len(), graph.nodes.id.len());
    if let Some(&low) = phases.ranks.iter().min() {
        assert_eq!(low, 0, "the lowest real node is at rank 0");
    }
    for (edge, kind) in graph.edges.kind.iter().enumerate() {
        let reversed = phases.reversed.contains(&edge);
        let Some(policy) = options.edge_kinds.get(kind).filter(|p| p.ranks) else {
            assert!(
                !reversed,
                "edge {edge} does not rank, so it is not reversed"
            );
            continue;
        };
        let source = index_of(&graph.nodes.id, &graph.edges.source[edge]);
        let target = index_of(&graph.nodes.id, &graph.edges.target[edge]);
        if source == target {
            continue;
        }
        let (from, to) = if reversed {
            (target, source)
        } else {
            (source, target)
        };
        let min_length = policy.min_length.unwrap_or(1.0);
        assert!(
            f(phases.ranks[to]) >= f(phases.ranks[from]) + min_length,
            "edge {edge} spans its minimum length"
        );
    }
}

/// Each rank's order holds each of its layered nodes once, and no other node.
fn assert_layers_are_permutations(phases: &Phases) {
    let layered = &phases.layered;
    assert_eq!(phases.layers.len(), layered.ranks);
    for (rank, layer) in phases.layers.iter().enumerate() {
        let mut units = layer.clone();
        units.sort_unstable();
        let expected: Vec<usize> = (0..layered.nodes.len())
            .filter(|&x| layered.nodes[x].rank == rank)
            .collect();
        assert_eq!(units, expected, "rank {rank} holds each of its units once");
    }
}

/// Each segment joins adjacent ranks, and each dummy that a chain passes through has one segment in and one out.
fn assert_chains_are_contiguous(phases: &Phases) {
    let layered = &phases.layered;
    for segment in &layered.segments {
        assert_eq!(
            layered.nodes[segment.bottom].rank,
            layered.nodes[segment.top].rank + 1,
            "a segment joins adjacent ranks"
        );
    }
    for (x, node) in layered.nodes.iter().enumerate() {
        if node.id.is_some() {
            continue;
        }
        let into = layered.segments.iter().filter(|s| s.bottom == x).count();
        let out = layered.segments.iter().filter(|s| s.top == x).count();
        assert!(
            into <= 1 && into == out,
            "dummy {x} lies on one chain, once in and once out, or on a spine only"
        );
    }
}

/// The node and edge gaps of the default spacing, which the runs of these tests leave in force.
const NODE_GAP: f64 = 12.0;
const EDGE_GAP: f64 = 4.0;

/// The slack the solver's separations are held to, in drawing units.
const TOLERANCE: f64 = 1e-6;

/// A random case that also takes either the rows or the levels across the ranks, and an anchor: a node of the graph, or
/// none.
fn placed_case() -> impl Strategy<Value = (Graph, Options)> {
    (case(), prop::bool::ANY, prop::option::of(0_usize..8)).prop_map(
        |((graph, mut options), levels, anchor)| {
            options.ranks = Some(if levels { Ranks::Levels } else { Ranks::Rows });
            options.anchor = anchor
                .filter(|_| !graph.nodes.id.is_empty())
                .map(|a| format!("n{}", a % graph.nodes.id.len()));
            (graph, options)
        },
    )
}

/// Each layered node's position along the ranks, by layered index: its `x` when the ranks run down, else its `y`.
fn along_axis(phases: &Phases, down: bool) -> Vec<f64> {
    phases
        .placement
        .points
        .iter()
        .map(|p| if down { p.x } else { p.y })
        .collect()
}

/// Each layered node's position across the ranks, by layered index: its `y` when the ranks run down, else its `x`.
fn across_axis(phases: &Phases, down: bool) -> Vec<f64> {
    phases
        .placement
        .points
        .iter()
        .map(|p| if down { p.y } else { p.x })
        .collect()
}

/// Each layered node's half-extent across the ranks: half its height going down and its width going right. A dummy has
/// none.
fn across_halves(graph: &Graph, phases: &Phases, down: bool) -> Vec<f64> {
    phases
        .layered
        .nodes
        .iter()
        .map(|node| {
            node.id.map_or(0.0, |n| {
                let extent = if down {
                    graph.nodes.height[n]
                } else {
                    graph.nodes.width[n]
                };
                extent / 2.0
            })
        })
        .collect()
}

/// The least distance between the centres of `u` and `v` when `u` is left of `v` in their rank: half of each breadth plus
/// the gap of `gapsLeft` (`place/gaps.ts`): the node gap between two real nodes of different blocks, else the edge gap.
fn least_gap(layered: &LayeredGraph, u: usize, v: usize) -> f64 {
    let anchored = |x: usize| layered.nodes[x].id.is_some();
    let gap = if layered.block[u] != layered.block[v] && anchored(u) && anchored(v) {
        NODE_GAP
    } else {
        EDGE_GAP
    };
    f64::midpoint(layered.nodes[u].breadth, layered.nodes[v].breadth) + gap
}

proptest! {
    #[test]
    fn every_rank_assignment_is_valid((graph, options) in case()) {
        let phases = run_phases(&graph, &options).expect("a valid graph runs");
        assert_ranks_valid(&graph, &options, &phases);
    }

    #[test]
    fn every_layer_is_a_permutation_of_its_units((graph, options) in case()) {
        let phases = run_phases(&graph, &options).expect("a valid graph runs");
        assert_layers_are_permutations(&phases);
    }

    #[test]
    fn dummy_chains_are_contiguous((graph, options) in case()) {
        let phases = run_phases(&graph, &options).expect("a valid graph runs");
        assert_chains_are_contiguous(&phases);
    }

    #[test]
    fn the_same_input_gives_the_same_output((graph, options) in case()) {
        let first = run_phases(&graph, &options);
        let second = run_phases(&graph, &options);
        prop_assert_eq!(first, second);
    }

    #[test]
    fn every_placed_node_is_finite((graph, options) in placed_case()) {
        let phases = run_phases(&graph, &options).expect("a valid graph runs");
        let placement = &phases.placement;
        prop_assert!(placement.points.iter().all(|p| p.x.is_finite() && p.y.is_finite()));
        prop_assert!(placement.centres.iter().chain(&placement.rank_half).all(|v| v.is_finite()));
    }

    #[test]
    fn no_two_nodes_overlap_in_a_rank((graph, options) in placed_case()) {
        let phases = run_phases(&graph, &options).expect("a valid graph runs");
        let along = along_axis(&phases, options.direction == Direction::Down);
        for layer in &phases.layers {
            for pair in layer.windows(2) {
                let (u, v) = (pair[0], pair[1]);
                let apart = along[v] - along[u];
                prop_assert!(
                    apart + TOLERANCE >= least_gap(&phases.layered, u, v),
                    "nodes {u} and {v} sit {apart} apart in their rank"
                );
            }
        }
    }

    #[test]
    fn nodes_of_different_ranks_that_overlap_in_rank_stay_apart_across((graph, options) in placed_case()) {
        let phases = run_phases(&graph, &options).expect("a valid graph runs");
        let down = options.direction == Direction::Down;
        let along = along_axis(&phases, down);
        let across = across_axis(&phases, down);
        let half = across_halves(&graph, &phases, down);
        let nodes = &phases.layered.nodes;
        for u in 0..nodes.len() {
            for v in u + 1..nodes.len() {
                if nodes[u].rank == nodes[v].rank {
                    continue;
                }
                let in_rank = f64::midpoint(nodes[u].breadth, nodes[v].breadth);
                if (along[u] - along[v]).abs() + TOLERANCE >= in_rank {
                    continue;
                }
                let apart = (across[u] - across[v]).abs();
                prop_assert!(
                    apart + TOLERANCE >= half[u] + half[v],
                    "nodes {u} and {v} of different ranks sit {apart} apart across"
                );
            }
        }
    }

    #[test]
    fn the_same_input_gives_the_same_placement((graph, options) in placed_case()) {
        let first = run_phases(&graph, &options).map(|phases| phases.placement);
        let second = run_phases(&graph, &options).map(|phases| phases.placement);
        prop_assert_eq!(first, second);
    }
}

/// A random placed graph whose two clusters are each opaque or not, by a coin each, so that the opaque gate has boxes to
/// keep edges out of.
pub(in crate::engine) fn opaque_case() -> impl Strategy<Value = (Graph, Options)> {
    (placed_case(), prop::collection::vec(prop::bool::ANY, 2)).prop_map(
        |((mut graph, options), opaque)| {
            graph.clusters.opaque = opaque.into_iter().map(Some).collect();
            (graph, options)
        },
    )
}

/// Whether `node` is in `cluster`, or in one of its descendants: the cluster is on the chain from the node's own cluster
/// up through the parents.
fn holds(graph: &Graph, node: usize, cluster: usize) -> bool {
    let index_named = |id: &str| graph.clusters.id.iter().position(|c| c == id);
    let mut current = graph.nodes.cluster[node].as_deref().and_then(index_named);
    for _ in 0..graph.clusters.id.len() {
        let Some(c) = current else {
            return false;
        };
        if c == cluster {
            return true;
        }
        current = graph.clusters.parent[c].as_deref().and_then(index_named);
    }
    false
}

/// The routing gate: every edge is flagged, or drawn as an orthogonal polyline that starts at its source's position along
/// the ranks and ends at its target's. No drawn edge breaches an opaque box that holds neither of its ends, by the
/// route's own check.
fn assert_routing_gate(graph: &Graph, down: bool, phases: &Phases) {
    let routing = &phases.routing;
    assert_eq!(routing.edges.len(), graph.edges.id.len());
    let boxes: Vec<Rect> = routing.clusters.iter().map(|b| b.rect).collect();
    let along = |p: &Point| if down { p.x } else { p.y };
    for (edge, drawn) in routing.edges.iter().enumerate() {
        let source = index_of(&graph.nodes.id, &graph.edges.source[edge]);
        let target = index_of(&graph.nodes.id, &graph.edges.target[edge]);
        let points = match drawn {
            EdgeRoute::Routed(points) => points,
            EdgeRoute::RouteFailed => continue,
            EdgeRoute::NotRouted => panic!("edge {edge}: no kind is unrouted in this strategy"),
        };
        assert_ne!(source, target, "edge {edge}: a self-loop is not drawn");
        assert!(points.len() >= 2, "edge {edge} has two ends");
        assert!(
            points
                .windows(2)
                .all(|w| same_coordinate(w[0].x, w[1].x) || same_coordinate(w[0].y, w[1].y)),
            "edge {edge} is orthogonal"
        );
        // An end with no port sits at its node's centre. A port's end sits on the node's side, within its along-extent.
        let end_gate = |end: &Point, node: usize, port: Option<&String>| {
            let extent = if down {
                graph.nodes.width[node]
            } else {
                graph.nodes.height[node]
            };
            let delta = (along(end) - along(&routing.nodes[node])).abs();
            if port.is_none() {
                assert!(
                    same_coordinate(delta, 0.0),
                    "edge {edge} ends at its node's centre"
                );
            } else {
                assert!(
                    delta <= extent / 2.0 + 1e-9,
                    "edge {edge} ends on its node's side"
                );
            }
        };
        end_gate(&points[0], source, graph.edges.source_port[edge].as_ref());
        end_gate(
            &points[points.len() - 1],
            target,
            graph.edges.target_port[edge].as_ref(),
        );
        let watched: Vec<bool> = routing
            .clusters
            .iter()
            .map(|b| {
                graph.clusters.opaque.get(b.cluster).copied().flatten() == Some(true)
                    && !holds(graph, source, b.cluster)
                    && !holds(graph, target, b.cluster)
            })
            .collect();
        assert!(
            breaches(points, &boxes, &watched).is_empty(),
            "edge {edge} breaches an opaque box"
        );
    }
}

/// `case`, with lateral and flow-side ports on random nodes and edge ends that name them.
pub(in crate::engine) fn ported_case() -> impl Strategy<Value = (Graph, Options)> {
    (
        case(),
        prop::collection::vec((0_u8..4, 0.0_f64..=1.0), 0..12),
        prop::collection::vec(
            (prop::option::of(0_usize..12), prop::option::of(0_usize..12)),
            0..24,
        ),
    )
        .prop_map(|((mut graph, options), ports, ends)| {
            add_ports(&mut graph, &ports, &ends);
            (graph, options)
        })
}

/// `opaque_case`, with ports as `ported_case` adds them: lateral ports whose stubs may meet an opaque box.
pub(in crate::engine) fn ported_opaque_case() -> impl Strategy<Value = (Graph, Options)> {
    (
        opaque_case(),
        prop::collection::vec((0_u8..4, 0.0_f64..=1.0), 0..12),
        prop::collection::vec(
            (prop::option::of(0_usize..12), prop::option::of(0_usize..12)),
            0..24,
        ),
    )
        .prop_map(|((mut graph, options), ports, ends)| {
            add_ports(&mut graph, &ports, &ends);
            (graph, options)
        })
}

/// Gives the nodes of `graph` ports, one per entry of `ports` (its side and its offset as a share of the node's smaller
/// extent, so it lies on every side), and names one of each node's ports at the ends of the edges `ends` picks.
fn add_ports(graph: &mut Graph, ports: &[(u8, f64)], ends: &[(Option<usize>, Option<usize>)]) {
    const SIDES: [&str; 4] = ["north", "east", "south", "west"];
    let count = graph.nodes.id.len();
    if count == 0 {
        return;
    }
    let mut table = Ports::default();
    for (k, &(side, fraction)) in ports.iter().enumerate() {
        let owner = k % count;
        let limit = graph.nodes.width[owner].min(graph.nodes.height[owner]);
        table.node.push(u32::try_from(owner).expect("small"));
        table.id.push(format!("p{k}"));
        table.side.push(SIDES[usize::from(side)].to_owned());
        table.offset.push(fraction * limit);
    }
    graph.nodes.ports = table;
    for e in 0..graph.edges.id.len() {
        let (s, t) = ends.get(e).copied().unwrap_or((None, None));
        let source = index_of(&graph.nodes.id, &graph.edges.source[e]);
        let target = index_of(&graph.nodes.id, &graph.edges.target[e]);
        graph.edges.source_port[e] = pick(ports.len(), count, source, s);
        graph.edges.target_port[e] = pick(ports.len(), count, target, t);
    }
}

/// The id of one of the ports `node` owns, chosen by `choice`; `None` when the edge names no port or the node has none.
fn pick(ports: usize, count: usize, node: usize, choice: Option<usize>) -> Option<String> {
    let owned: Vec<usize> = (0..ports).filter(|k| k % count == node).collect();
    let i = choice?;
    if owned.is_empty() {
        return None;
    }
    Some(format!("p{}", owned[i % owned.len()]))
}

proptest! {
    #[test]
    fn every_routed_edge_keeps_to_the_gate((graph, options) in opaque_case()) {
        let phases = run_phases(&graph, &options).expect("a valid graph runs");
        assert_routing_gate(&graph, options.direction == Direction::Down, &phases);
    }

    #[test]
    fn the_same_input_gives_the_same_routing((graph, options) in placed_case()) {
        let first = run_phases(&graph, &options).map(|phases| phases.routing);
        let second = run_phases(&graph, &options).map(|phases| phases.routing);
        prop_assert_eq!(first, second);
    }
}

/// The drawing the route drew, as `metrics` measures it: each node's box about its centre, each drawn edge's polyline, and
/// the cluster boxes as opaque boxes. An edge may enter the boxes its route leaves it free to, which are the boxes that
/// are not opaque and the boxes holding one of its ends (the route's own rule, `watched_boxes`).
fn drawing_of(graph: &Graph, phases: &Phases) -> Drawing {
    let routing = &phases.routing;
    let boxes: Vec<crate::model::Rect> = routing
        .nodes
        .iter()
        .enumerate()
        .map(|(node, centre)| {
            let (width, height) = (graph.nodes.width[node], graph.nodes.height[node]);
            crate::model::Rect {
                x: centre.x - width / 2.0,
                y: centre.y - height / 2.0,
                width,
                height,
            }
        })
        .collect();
    let opaque_boxes: Vec<crate::model::Rect> = routing
        .clusters
        .iter()
        .map(|b| crate::model::Rect {
            x: b.rect.x,
            y: b.rect.y,
            width: b.rect.width,
            height: b.rect.height,
        })
        .collect();
    let mut paths = Vec::new();
    let mut allowed = Vec::new();
    for (edge, drawn) in routing.edges.iter().enumerate() {
        let EdgeRoute::Routed(points) = drawn else {
            continue;
        };
        let source = index_of(&graph.nodes.id, &graph.edges.source[edge]);
        let target = index_of(&graph.nodes.id, &graph.edges.target[edge]);
        let may_enter = |cluster: usize| {
            let opaque = graph.clusters.opaque.get(cluster).copied().flatten() == Some(true);
            !opaque || holds(graph, source, cluster) || holds(graph, target, cluster)
        };
        paths.push(DrawnPath {
            points: points
                .iter()
                .map(|p| crate::model::Point { x: p.x, y: p.y })
                .collect(),
            source,
            target,
            trunk: None,
        });
        allowed.push(
            routing
                .clusters
                .iter()
                .enumerate()
                .filter(|(_, b)| may_enter(b.cluster))
                .map(|(boxed, _)| boxed)
                .collect::<BTreeSet<usize>>(),
        );
    }
    Drawing {
        boxes,
        paths,
        opaque: Some(Opaque {
            boxes: opaque_boxes,
            allowed,
        }),
    }
}

/// The measures of a routed drawing: no drawn edge breaches an opaque box, the crossings are the ones the brute force
/// counts, every measure is finite, and the same drawing measures the same.
fn assert_measures(graph: &Graph, phases: &Phases) {
    let drawing = drawing_of(graph, phases);
    let measured = measure(&drawing);
    let paths: Vec<Vec<crate::model::Point>> =
        drawing.paths.iter().map(|p| p.points.clone()).collect();
    let trunks: Vec<Option<usize>> = drawing.paths.iter().map(|p| p.trunk).collect();
    assert_eq!(
        measured.opaque_breaches, 0.0,
        "a drawn edge breaches an opaque box"
    );
    assert_eq!(
        measured.crossings,
        f(brute_crossings(&paths, &trunks)),
        "the sweep and the brute force count the same crossings"
    );
    for value in [
        measured.crossings,
        measured.bends,
        measured.edge_length,
        measured.area,
        measured.density,
        measured.overlaps,
        measured.opaque_breaches,
    ] {
        assert!(value.is_finite(), "a measure is not finite: {measured:?}");
    }
    assert_eq!(
        measure(&drawing),
        measured,
        "the same drawing measures the same"
    );
}

proptest! {
    #[test]
    fn measured_routes_keep_to_the_gate_and_count_crossings_by_brute_force((graph, options) in opaque_case()) {
        let phases = run_phases(&graph, &options).expect("a valid graph runs");
        assert_measures(&graph, &phases);
    }

    #[test]
    fn measured_levels_routes_keep_to_the_gate_and_count_crossings_by_brute_force((graph, options) in levels_case()) {
        let phases = run_phases(&graph, &options).expect("a valid graph runs");
        assert_measures(&graph, &phases);
    }
}

/// A random case under `ranks: "levels"`, with opaque boxes: the cases of `opaque_case`, with the levels across the ranks.
pub(in crate::engine) fn levels_case() -> impl Strategy<Value = (Graph, Options)> {
    opaque_case().prop_map(|(graph, mut options)| {
        options.ranks = Some(Ranks::Levels);
        (graph, options)
    })
}

#[test]
fn levels_routes_keep_to_the_gate_and_draw_edges() {
    // A deterministic runner, so the cases, and the count of drawn edges, are the same on every run. Without the count the
    // gate would hold vacuously for an all-flagged route.
    let drawn = std::cell::Cell::new(0_usize);
    let mut runner = proptest::test_runner::TestRunner::deterministic();
    runner
        .run(&levels_case(), |(graph, options)| {
            let phases = run_phases(&graph, &options).expect("a valid graph runs");
            assert_routing_gate(&graph, options.direction == Direction::Down, &phases);
            let routed = phases
                .routing
                .edges
                .iter()
                .filter(|edge| matches!(edge, EdgeRoute::Routed(_)))
                .count();
            drawn.set(drawn.get() + routed);
            Ok(())
        })
        .expect("every levels route keeps to the gate");
    assert!(drawn.get() > 0, "no levels edge was drawn");
}

/// A graph of `ids` nodes (10 by 10) joined by dependency edges between the given pairs of ids.
fn graph_of(ids: &[&str], pairs: &[(&str, &str)]) -> Graph {
    let (n, m) = (ids.len(), pairs.len());
    Graph {
        nodes: Nodes {
            id: ids.iter().map(|id| (*id).to_owned()).collect(),
            width: vec![10.0; n],
            height: vec![10.0; n],
            cluster: vec![None; n],
            partition: vec![None; n],
            ports: Ports::default(),
        },
        edges: Edges {
            id: (0..m).map(|i| format!("e{i}")).collect(),
            source: pairs.iter().map(|p| p.0.to_owned()).collect(),
            target: pairs.iter().map(|p| p.1.to_owned()).collect(),
            source_port: vec![None; m],
            target_port: vec![None; m],
            kind: vec!["dependency".to_owned(); m],
        },
        clusters: Clusters::default(),
    }
}

/// Options with one ranking kind, `dependency`, of minimum length 1.
fn dependency_options() -> Options {
    Options {
        edge_kinds: BTreeMap::from([(
            "dependency".to_owned(),
            EdgeKindPolicy {
                ranks: true,
                ..EdgeKindPolicy::default()
            },
        )]),
        ..Options::default()
    }
}

#[test]
fn a_chain_has_one_node_per_rank_and_per_layer() {
    let graph = graph_of(&["a", "b", "c"], &[("a", "b"), ("b", "c")]);
    let phases = run_phases(&graph, &dependency_options()).expect("a chain runs");
    assert_eq!(phases.ranks, vec![0, 1, 2]);
    assert_eq!(phases.layers, vec![vec![0], vec![1], vec![2]]);
    assert_eq!(phases.crossings, 0.0);
}

#[test]
fn an_edge_across_two_ranks_gets_one_dummy_in_the_middle_rank() {
    let graph = graph_of(&["a", "b", "c"], &[("a", "b"), ("b", "c"), ("a", "c")]);
    let phases = run_phases(&graph, &dependency_options()).expect("a triangle runs");
    assert_eq!(phases.ranks, vec![0, 1, 2]);
    let dummy = &phases.layered.nodes[3];
    assert_eq!((dummy.id, dummy.rank), (None, 1));
    let mut middle = phases.layers[1].clone();
    middle.sort_unstable();
    assert_eq!(middle, vec![1, 3]);
}

#[test]
fn an_empty_graph_has_no_ranks_and_no_layers() {
    let phases = run_phases(&graph_of(&[], &[]), &Options::default()).expect("nothing to lay out");
    assert_eq!(phases.ranks, Vec::<usize>::new());
    assert_eq!(phases.layers, Vec::<Vec<usize>>::new());
    assert_eq!(phases.layered.nodes.len(), 0);
}

#[test]
fn a_lateral_port_that_an_edge_leaves_through_is_drawn_as_a_stub() {
    let mut graph = graph_of(&["a", "b"], &[("a", "b")]);
    graph.nodes.ports = Ports {
        node: vec![0],
        id: vec!["p".to_owned()],
        side: vec!["east".to_owned()],
        offset: vec![7.0],
    };
    graph.edges.source_port = vec![Some("p".to_owned())];
    let phases = run_phases(&graph, &dependency_options()).expect("a lateral port runs");
    let EdgeRoute::Routed(points) = &phases.routing.edges[0] else {
        panic!("the edge is drawn: {:?}", phases.routing.edges[0]);
    };
    // The east side of a 10-wide, 10-high node, at offset 7 from its top: the stub leaves the node's right edge at 2
    // below its centre, and the first bend is on that line.
    let centre = phases.routing.nodes[0];
    assert_eq!(points[0].x, centre.x + 5.0);
    assert_eq!(points[0].y, centre.y + 2.0);
    assert_eq!(points[1].y, centre.y + 2.0, "the stub is horizontal");
}

#[test]
fn an_effort_with_no_budget_is_refused_by_name() {
    let options = Options {
        effort: Some("slow".to_owned()),
        ..dependency_options()
    };
    assert_eq!(
        run_phases(&graph_of(&["a"], &[]), &options),
        Err(PhaseError::UnknownEffort("slow".to_owned()))
    );
}

#[test]
fn a_fractional_minimum_length_is_refused() {
    let mut options = dependency_options();
    let policy = options
        .edge_kinds
        .get_mut("dependency")
        .expect("the policy is set");
    policy.min_length = Some(1.5);
    assert_eq!(
        run_phases(&graph_of(&["a", "b"], &[("a", "b")]), &options),
        Err(PhaseError::NonIntegerRank)
    );
}

#[test]
fn the_seed_reads_as_the_typescript_unsigned_shift() {
    assert_eq!(to_uint32(0.0), 0);
    assert_eq!(to_uint32(42.9), 42);
    assert_eq!(to_uint32(-1.0), u32::MAX);
    assert_eq!(to_uint32(4_294_967_301.0), 5);
    assert_eq!(to_uint32(f64::NAN), 0);
    assert_eq!(to_uint32(f64::INFINITY), 0);
}

#[test]
fn a_rank_is_whole_only_below_2_to_the_32() {
    assert_eq!(whole_rank(3.0), Some(3));
    assert_eq!(whole_rank(1.5), None);
    assert_eq!(whole_rank(-1.0), None);
    assert_eq!(whole_rank(4_294_967_296.0), None);
    assert_eq!(whole_rank(f64::NAN), None);
}

#[test]
fn the_hints_of_a_graph_name_its_nodes_by_index() {
    let rows = hints_of(2, &[(3, 1, 0)]);
    assert_eq!(rows.id, vec!["n1".to_owned()]);
    assert_eq!(rows.rank, vec![1]);
    assert_eq!(rows.order, vec![0]);
}

proptest! {
    #[test]
    fn lateral_ports_are_routed_or_flagged_and_keep_to_the_gate((graph, options) in ported_case()) {
        let phases = run_phases(&graph, &options).expect("a valid graph runs");
        assert_routing_gate(&graph, options.direction == Direction::Down, &phases);
    }

    #[test]
    fn lateral_ports_beside_opaque_boxes_keep_to_the_gate((graph, options) in ported_opaque_case()) {
        let phases = run_phases(&graph, &options).expect("a valid graph runs");
        assert_routing_gate(&graph, options.direction == Direction::Down, &phases);
    }
}
