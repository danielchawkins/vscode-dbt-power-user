//! The layout measured on a graph written as text (Phase 6 "Baseline"): the finance lineage graph and the 3,000-node
//! synthetic DAG, both flattened by `scripts/bench/flatten-graph.mjs`. This is a measurement, not a gate: each graph is
//! laid out at the effort of `GRAPH_LAYOUT_BENCH_EFFORT` with the options of the TypeScript baseline (rows, soft
//! partitions, spacing 28/36/6/28), passes the layout gate, and prints its metrics. The core reads no clock, so
//! `scripts/bench/layout-timings.mjs` times each whole test process from outside, at two repeat counts. Without
//! `GRAPH_LAYOUT_BENCH_GRAPH` the test does nothing.

use std::collections::BTreeMap;

use super::layout;
use super::tests::assert_layout_gate;
use crate::model::{Direction, EdgeKindPolicy, Graph, Options, PartialSpacing, Partitions, Ranks};

/// The options of the baseline: `direction: "down"`, the `table` kind ranks, soft partitions, rows, and the spacing
/// 28/36/6/28 that `full-graph.mjs` and `layering-graphs.mjs` pass.
fn baseline_options(effort: &str) -> Options {
    Options {
        direction: Direction::Down,
        edge_kinds: BTreeMap::from([(
            "table".to_owned(),
            EdgeKindPolicy {
                ranks: true,
                ..EdgeKindPolicy::default()
            },
        )]),
        spacing: Some(PartialSpacing {
            node: Some(28.0),
            rank: Some(36.0),
            edge: Some(6.0),
            cluster: Some(28.0),
        }),
        partitions: Some(Partitions::Soft),
        ranks: Some(Ranks::Rows),
        effort: Some(effort.to_owned()),
        ..Options::default()
    }
}

/// The graph of a text file: one record per line, its fields tab-separated, in file order (the input order).
/// `node id width height partition cluster` (`-` for no band and no cluster), `cluster id padding` and
/// `edge id source target kind`. Lines that start with `#` are comments.
fn parse_graph(text: &str) -> Graph {
    let mut graph = Graph::default();
    for line in text
        .lines()
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
    {
        let fields: Vec<&str> = line.split('\t').collect();
        match fields[..] {
            ["node", id, width, height, partition, cluster] => {
                graph.nodes.id.push(id.to_owned());
                graph.nodes.width.push(number(width));
                graph.nodes.height.push(number(height));
                graph.nodes.partition.push(optional(partition).map(number));
                graph
                    .nodes
                    .cluster
                    .push(optional(cluster).map(str::to_owned));
            }
            ["cluster", id, padding] => {
                graph.clusters.id.push(id.to_owned());
                graph.clusters.parent.push(None);
                graph.clusters.padding.push(Some(number(padding)));
                graph.clusters.label_height.push(None);
                graph.clusters.opaque.push(None);
            }
            ["edge", id, source, target, kind] => {
                graph.edges.id.push(id.to_owned());
                graph.edges.source.push(source.to_owned());
                graph.edges.target.push(target.to_owned());
                graph.edges.source_port.push(None);
                graph.edges.target_port.push(None);
                graph.edges.kind.push(kind.to_owned());
            }
            _ => panic!("a benchmark graph record is not a node, cluster or edge: {line}"),
        }
    }
    graph
}

fn number(text: &str) -> f64 {
    text.parse()
        .unwrap_or_else(|_| panic!("a benchmark number is not a number: {text}"))
}

fn optional(field: &str) -> Option<&str> {
    (field != "-").then_some(field)
}

/// The layout of the graph of `GRAPH_LAYOUT_BENCH_GRAPH` at `GRAPH_LAYOUT_BENCH_EFFORT`, `GRAPH_LAYOUT_BENCH_REPEATS`
/// times (each repeat must give the same metrics). It prints one line: the effort, the counts, the metrics and the
/// bounds, and the edges flagged as not routed. Every number is printed with `Display`, the shortest exact form.
#[test]
fn layout_workload_is_measured() {
    let Some(path) = std::env::var_os("GRAPH_LAYOUT_BENCH_GRAPH") else {
        return;
    };
    let effort = std::env::var("GRAPH_LAYOUT_BENCH_EFFORT")
        .expect("GRAPH_LAYOUT_BENCH_EFFORT is set with the workload");
    let repeats: u32 = std::env::var("GRAPH_LAYOUT_BENCH_REPEATS")
        .expect("GRAPH_LAYOUT_BENCH_REPEATS is set with the workload")
        .parse()
        .expect("GRAPH_LAYOUT_BENCH_REPEATS is a count");
    let text = std::fs::read_to_string(&path).expect("the benchmark graph is readable");
    let graph = parse_graph(&text);
    let options = baseline_options(&effort);
    assert_layout_gate(&graph, &options);
    let first = layout(&graph, &options).expect("the benchmark graph lays out");
    assert_eq!(first.metrics.overlaps, 0.0, "two nodes overlap");
    for _ in 1..repeats {
        let again = layout(&graph, &options).expect("the benchmark graph lays out");
        assert_eq!(again.metrics, first.metrics, "a repeat gives other metrics");
    }
    let flagged = first
        .edges
        .route_failed
        .iter()
        .filter(|failed| **failed)
        .count();
    let metrics = first.metrics;
    let bounds = first.bounds;
    println!(
        "layout-bench {effort} nodes {} edges {} crossings {} bends {} edge_length {} width {} height {} flagged {flagged}",
        graph.nodes.id.len(),
        graph.edges.id.len(),
        metrics.crossings,
        metrics.bends,
        metrics.edge_length,
        bounds.width,
        bounds.height,
    );
}
