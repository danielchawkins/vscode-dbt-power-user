//! The layout on random graphs, and the refusal of invalid input. The gate of the routed edges, the measures, the
//! finiteness of every number, the determinism of the encoded frame and the bounds run on the phases' random cases,
//! made valid for `validate`. The deterministic cases fix the flags of a self-loop, an unrouted kind, the partition
//! boxes and the refused input. The thorough effort, with its restarts, passes the same gate, repeats byte for byte, and
//! never has more crossings than its first search; `GRAPH_LAYOUT_THOROUGH_OUT` writes its frame for the thread sweep.

use std::collections::BTreeMap;
use std::fmt::Write;

use proptest::prelude::*;

use super::{LayoutError, layout};
use crate::budget::Budget;
use crate::engine::phases::run_phases;
use crate::engine::phases::tests::{case, levels_case, opaque_case};
use crate::engine::phases::to_uint32;
use crate::model::{
    Clusters, Direction, EdgeKindPolicy, Edges, Graph, IssueCode, Layout, NodeLayouts, Nodes,
    Options, Partitions, Ports, Rect, encode_layout, validate,
};
use crate::order::order;
use crate::rand::Mulberry32;
use crate::route::same_coordinate;

/// The cases of `layout_outputs_are_written_for_the_parity_comparison`: one line per case, `case <name> <effort> <seed>
/// <nodes> <edges>`.
const LAYOUT_CASES: &str = include_str!("../../../fixtures/parity/layout-cases.txt");

/// The phases' random cases, with every edge kind valid for `validate`: a `plain` edge has no policy, so it takes the
/// `info` kind, which does not rank and is routed.
fn valid((mut graph, options): (Graph, Options)) -> (Graph, Options) {
    for kind in &mut graph.edges.kind {
        if kind.as_str() == "plain" {
            *kind = "info".to_owned();
        }
    }
    (graph, options)
}

/// Whether two coordinates agree to a relative 1e-9. A centre is rebuilt from its rectangle, so it can be an ulp off.
fn approx(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-9 * (1.0 + a.abs().max(b.abs()))
}

/// The index of the node named `id`.
fn index_of(graph: &Graph, id: &str) -> usize {
    graph
        .nodes
        .id
        .iter()
        .position(|n| n == id)
        .expect("an edge names a node")
}

/// The rectangle of node `i` of the layout.
fn node_rect(nodes: &NodeLayouts, i: usize) -> Rect {
    Rect {
        x: nodes.x[i],
        y: nodes.y[i],
        width: nodes.width[i],
        height: nodes.height[i],
    }
}

/// The layout gate. Each edge of a routed kind is drawn by an axis-aligned polyline that starts at its source's centre
/// along the ranks and ends at its target's, or it is flagged with no points. An edge of an unrouted kind has no entry.
/// No drawn edge breaches an opaque box. Every number is finite, the same input gives the same frame, and the bounds
/// hold every node.
pub(super) fn assert_layout_gate(graph: &Graph, options: &Options) {
    let laid_out = layout(graph, options).expect("a valid graph lays out");
    assert_edges_gate(graph, options, &laid_out);
    assert_eq!(
        laid_out.metrics.opaque_breaches, 0.0,
        "a drawn edge breaches an opaque box"
    );
    assert!(
        all_finite(&laid_out),
        "a number is not finite: {laid_out:?}"
    );
    let again = layout(graph, options).expect("a valid graph lays out");
    assert_eq!(
        encode_layout(&laid_out),
        encode_layout(&again),
        "the same input gives a different frame"
    );
    assert_bounds_hold_nodes(&laid_out);
}

/// The edge rows of the layout against the graph: one row per edge of a routed kind, in edge order.
fn assert_edges_gate(graph: &Graph, options: &Options, laid_out: &Layout) {
    let down = options.direction == Direction::Down;
    // The coordinate along the ranks, as the route takes it: x going down, y going right.
    let along = |(x, y): (f64, f64)| if down { x } else { y };
    let edges = &laid_out.edges;
    let mut row = 0;
    for e in 0..graph.edges.id.len() {
        let routed = options
            .edge_kinds
            .get(&graph.edges.kind[e])
            .and_then(|policy| policy.routed)
            != Some(false);
        if !routed {
            assert!(
                !edges.id.contains(&graph.edges.id[e]),
                "edge {} of an unrouted kind has an entry",
                graph.edges.id[e]
            );
            continue;
        }
        assert_eq!(
            edges.id[row], graph.edges.id[e],
            "the rows follow the edges"
        );
        let start = usize::try_from(edges.point_start[row]).expect("a point index fits");
        let end = usize::try_from(edges.point_start[row + 1]).expect("a point index fits");
        let points: Vec<(f64, f64)> = (start..end)
            .map(|p| (edges.point_x[p], edges.point_y[p]))
            .collect();
        let source = index_of(graph, &graph.edges.source[e]);
        let target = index_of(graph, &graph.edges.target[e]);
        if edges.route_failed[row] {
            assert!(points.is_empty(), "flagged edge {row} has no points");
        } else {
            assert_ne!(source, target, "a self-loop is flagged, not drawn");
            assert!(points.len() >= 2, "a drawn edge has two ends");
            assert!(
                points
                    .windows(2)
                    .all(|w| same_coordinate(w[0].0, w[1].0) || same_coordinate(w[0].1, w[1].1)),
                "a drawn edge is axis-aligned"
            );
            let centre = |node: usize| {
                let rect = node_rect(&laid_out.nodes, node);
                along((rect.x + rect.width / 2.0, rect.y + rect.height / 2.0))
            };
            assert!(
                approx(along(points[0]), centre(source)),
                "a drawn edge starts at its source"
            );
            assert!(
                approx(along(points[points.len() - 1]), centre(target)),
                "a drawn edge ends at its target"
            );
        }
        row += 1;
    }
    assert_eq!(row, edges.id.len(), "every row is an edge of a routed kind");
}

/// Whether every coordinate and every metric of the layout is finite.
fn all_finite(laid_out: &Layout) -> bool {
    let columns = [
        &laid_out.nodes.x,
        &laid_out.nodes.y,
        &laid_out.nodes.width,
        &laid_out.nodes.height,
        &laid_out.clusters.x,
        &laid_out.clusters.y,
        &laid_out.clusters.width,
        &laid_out.clusters.height,
        &laid_out.partitions.partition,
        &laid_out.partitions.x,
        &laid_out.partitions.y,
        &laid_out.partitions.width,
        &laid_out.partitions.height,
        &laid_out.edges.point_x,
        &laid_out.edges.point_y,
        &laid_out.hints.x,
        &laid_out.hints.y,
    ];
    let m = &laid_out.metrics;
    let b = &laid_out.bounds;
    let scalars = [
        b.x,
        b.y,
        b.width,
        b.height,
        m.crossings,
        m.bends,
        m.edge_length,
        m.area,
        m.density,
        m.overlaps,
        m.opaque_breaches,
    ];
    columns
        .iter()
        .all(|column| column.iter().all(|v| v.is_finite()))
        && scalars.iter().all(|v| v.is_finite())
}

/// The bounds hold every node rectangle.
fn assert_bounds_hold_nodes(laid_out: &Layout) {
    let b = laid_out.bounds;
    let at_most = |a: f64, c: f64| a <= c || approx(a, c);
    for i in 0..laid_out.nodes.id.len() {
        let r = node_rect(&laid_out.nodes, i);
        assert!(
            at_most(b.x, r.x)
                && at_most(b.y, r.y)
                && at_most(r.x + r.width, b.x + b.width)
                && at_most(r.y + r.height, b.y + b.height),
            "the bounds {b:?} hold node {i} at {r:?}"
        );
    }
}

proptest! {
    #[test]
    fn every_routed_edge_is_drawn_or_flagged_and_the_layout_is_finite_and_repeatable(
        (graph, options) in case().prop_map(valid)
    ) {
        assert_layout_gate(&graph, &options);
    }

    #[test]
    fn the_layout_keeps_clear_of_opaque_boxes((graph, options) in opaque_case().prop_map(valid)) {
        assert_layout_gate(&graph, &options);
    }

    #[test]
    fn the_levels_layout_passes_the_same_gate((graph, options) in levels_case().prop_map(valid)) {
        assert_layout_gate(&graph, &options);
    }

    #[test]
    fn a_thorough_layout_passes_the_same_gate_and_repeats_byte_for_byte((graph, options) in thorough_case()) {
        assert_layout_gate(&graph, &options);
    }

    #[test]
    fn a_thorough_order_has_no_more_crossings_than_its_restart_zero_start((graph, options) in thorough_case()) {
        assert_no_more_crossings_than_the_start(&graph, &options);
    }
}

/// The random cases at `thorough`, with every edge kind valid for `validate`.
fn thorough_case() -> impl Strategy<Value = (Graph, Options)> {
    case().prop_map(valid).prop_map(|(graph, mut options)| {
        options.effort = Some("thorough".to_owned());
        (graph, options)
    })
}

/// The thorough order keeps the order of its first search unless a restart has strictly fewer crossings, so it has no
/// more crossings than that search. Both orders are taken of the layered graph `run_phases` builds, without hints, so
/// the start is the unhinted depth-first order: the restart-zero search.
fn assert_no_more_crossings_than_the_start(graph: &Graph, options: &Options) {
    let phases = run_phases(graph, options).expect("a valid graph runs the phases");
    let seed = to_uint32(options.seed.unwrap_or(0.0));
    let thorough = Budget::for_effort(Some("thorough")).expect("thorough is an effort");
    let first_search_only = Budget {
        restarts: 0,
        ..thorough
    };
    let with_restarts = order(&phases.layered, None, &thorough, seed).crossings;
    let start = order(&phases.layered, None, &first_search_only, seed).crossings;
    assert!(
        with_restarts <= start,
        "the restarts ended with {with_restarts} crossings, more than the start's {start}"
    );
}

/// The graph of the thread sweep: 60 nodes and 120 edges drawn from a fixed seed, all ranked and pointing down the
/// ranks, at `thorough` with a seed, so that the restarts have work to share between threads.
fn sweep_case() -> (Graph, Options) {
    random_case(60, 120, 11, "thorough", 3.0)
}

/// A random graph of `nodes` nodes and `edges` ranked edges drawn from `graph_seed`, each pointing from its lower node
/// index to its higher one, so that it ranks down. The options take `effort` and `seed`, with the kinds of
/// `rank_and_note`.
fn random_case(
    nodes: usize,
    edges: usize,
    graph_seed: u32,
    effort: &str,
    seed: f64,
) -> (Graph, Options) {
    let modulus = u32::try_from(nodes).expect("a test size fits in u32");
    let names: Vec<String> = (0..nodes).map(|i| format!("n{i}")).collect();
    let mut random = Mulberry32::new(graph_seed);
    let mut pairs: Vec<(usize, usize)> = Vec::new();
    while pairs.len() < edges {
        let a = usize::try_from(random.next_u32() % modulus).expect("an index fits");
        let b = usize::try_from(random.next_u32() % modulus).expect("an index fits");
        if a != b {
            pairs.push((a.min(b), a.max(b)));
        }
    }
    let edge_rows: Vec<(String, String, String, String)> = pairs
        .iter()
        .enumerate()
        .map(|(k, &(a, b))| {
            (
                format!("e{k}"),
                format!("n{a}"),
                format!("n{b}"),
                "rank".to_owned(),
            )
        })
        .collect();
    let ids: Vec<&str> = names.iter().map(String::as_str).collect();
    let rows: Vec<(&str, &str, &str, &str)> = edge_rows
        .iter()
        .map(|e| (e.0.as_str(), e.1.as_str(), e.2.as_str(), e.3.as_str()))
        .collect();
    let options = Options {
        effort: Some(effort.to_owned()),
        seed: Some(seed),
        ..rank_and_note()
    };
    (graph_of(&ids, &rows), options)
}

/// The layout outputs: each case of `layout-cases.txt` laid out at its effort, as one line `layout <name> <effort> <hex>`
/// with the bytes of `encode_layout` in hex. The test runs natively and under WASI and writes the output when
/// `GRAPH_LAYOUT_LAYOUT_OUT` names a file; `just layout-parity` compares the two files byte for byte.
#[test]
fn layout_outputs_are_written_for_the_parity_comparison() {
    let Some(path) = std::env::var_os("GRAPH_LAYOUT_LAYOUT_OUT") else {
        return;
    };
    let mut text = String::new();
    for line in LAYOUT_CASES
        .lines()
        .filter(|line| line.starts_with("case "))
    {
        let fields: Vec<&str> = line.split_whitespace().collect();
        let [_, name, effort, seed, nodes, edges] = fields[..] else {
            panic!("a layout case has five fields: {line}");
        };
        let seed: u32 = seed.parse().expect("a case seed is a u32");
        let nodes: usize = nodes.parse().expect("a case node count is a usize");
        let edges: usize = edges.parse().expect("a case edge count is a usize");
        let (graph, options) = random_case(nodes, edges, seed, effort, f64::from(seed));
        let laid_out = layout(&graph, &options).expect("a layout case lays out");
        let mut hex = String::new();
        for byte in encode_layout(&laid_out) {
            write!(hex, "{byte:02x}").expect("a string takes a digit");
        }
        writeln!(text, "layout {name} {effort} {hex}").expect("a string takes a line");
    }
    std::fs::write(&path, text).expect("the layout output is writable");
}

/// The thorough layout of `sweep_case`, encoded and written to the file `GRAPH_LAYOUT_THOROUGH_OUT` names. The thread
/// sweep runs it at 1, 2, 4 and 8 threads (rayon's global pool reads `RAYON_NUM_THREADS`) and compares the files byte
/// for byte. Without the variable the test does nothing.
#[test]
fn thorough_layout_is_written_for_the_thread_sweep() {
    let Some(path) = std::env::var_os("GRAPH_LAYOUT_THOROUGH_OUT") else {
        return;
    };
    let (graph, options) = sweep_case();
    let laid_out = layout(&graph, &options).expect("the sweep graph lays out");
    std::fs::write(&path, encode_layout(&laid_out)).expect("the thorough output is writable");
}

/// A graph of nodes `ids`, each ten by ten and in no cluster, and of edges `(id, source, target, kind)`.
fn graph_of(ids: &[&str], edges: &[(&str, &str, &str, &str)]) -> Graph {
    let n = ids.len();
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
            id: edges.iter().map(|e| e.0.to_owned()).collect(),
            source: edges.iter().map(|e| e.1.to_owned()).collect(),
            target: edges.iter().map(|e| e.2.to_owned()).collect(),
            source_port: vec![None; edges.len()],
            target_port: vec![None; edges.len()],
            kind: edges.iter().map(|e| e.3.to_owned()).collect(),
        },
        clusters: Clusters::default(),
    }
}

/// Options with the kinds `rank` (ranking), and `note` (not ranking, and not routed).
fn rank_and_note() -> Options {
    Options {
        edge_kinds: BTreeMap::from([
            (
                "rank".to_owned(),
                EdgeKindPolicy {
                    ranks: true,
                    ..EdgeKindPolicy::default()
                },
            ),
            (
                "note".to_owned(),
                EdgeKindPolicy {
                    routed: Some(false),
                    ..EdgeKindPolicy::default()
                },
            ),
        ]),
        ..Options::default()
    }
}

#[test]
fn a_self_loop_is_flagged_and_an_unrouted_kind_has_no_entry() {
    let graph = graph_of(
        &["a", "b"],
        &[
            ("e0", "a", "b", "rank"),
            ("e1", "a", "a", "rank"),
            ("e2", "b", "a", "note"),
        ],
    );
    let options = rank_and_note();
    let laid_out = layout(&graph, &options).expect("a valid graph lays out");
    assert_eq!(laid_out.edges.id, ["e0", "e1"]);
    assert_eq!(laid_out.edges.route_failed, [false, true]);
    let starts = &laid_out.edges.point_start;
    assert_eq!(starts.len(), 3, "one start per entry, and the end");
    assert_eq!(starts[1], starts[2], "the self-loop has no points");
    assert_layout_gate(&graph, &options);
}

#[test]
fn partition_boxes_hold_their_members_and_none_is_drawn_for_partitions_none() {
    let mut graph = graph_of(&["a", "b"], &[("e0", "a", "b", "rank")]);
    graph.nodes.partition = vec![Some(1.0), Some(0.0)];
    let mut options = rank_and_note();
    options.partitions = Some(Partitions::Soft);
    let laid_out = layout(&graph, &options).expect("a valid graph lays out");
    assert_eq!(laid_out.partitions.partition, [0.0, 1.0]);
    // Node `b` is in partition 0, node `a` in partition 1: each box is its one member's rectangle.
    assert!(approx(laid_out.partitions.x[0], laid_out.nodes.x[1]));
    assert!(approx(laid_out.partitions.y[0], laid_out.nodes.y[1]));
    assert!(approx(laid_out.partitions.x[1], laid_out.nodes.x[0]));
    assert!(approx(laid_out.partitions.y[1], laid_out.nodes.y[0]));
    options.partitions = Some(Partitions::None);
    let laid_out = layout(&graph, &options).expect("a valid graph lays out");
    assert_eq!(laid_out.partitions.partition, Vec::<f64>::new());
}

#[test]
fn an_input_that_validate_refuses_is_refused_with_every_issue() {
    let mut graph = graph_of(
        &["a", "b"],
        &[("e0", "a", "zz", "rank"), ("e1", "a", "b", "missing")],
    );
    graph.nodes.width[1] = -1.0;
    let options = rank_and_note();
    let expected = validate(&graph, &options).expect_err("the graph is invalid");
    let refused = layout(&graph, &options).expect_err("the graph is refused");
    let LayoutError::Input(error) = refused else {
        panic!("a validation refusal is an input error, not {refused:?}");
    };
    assert_eq!(error.issues(), expected.issues());
    let codes: Vec<IssueCode> = error.issues().iter().map(|issue| issue.code).collect();
    assert_eq!(
        codes,
        [
            IssueCode::BadSize,
            IssueCode::UnknownNode,
            IssueCode::UnknownKind
        ]
    );
}
