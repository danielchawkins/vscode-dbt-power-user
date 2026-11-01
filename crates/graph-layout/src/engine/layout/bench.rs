//! The layout measured on a graph written as text (Phase 6 "Baseline"): the finance lineage graph and the 3,000-node
//! synthetic DAG, both flattened by `scripts/bench/flatten-graph.mjs`. This is a measurement, not a gate: each graph is
//! laid out at the effort of `GRAPH_LAYOUT_BENCH_EFFORT` with the options of the TypeScript baseline (rows, soft
//! partitions, spacing 28/36/6/28), passes the layout gate, and prints its metrics. The core reads no clock, so
//! `scripts/bench/layout-timings.mjs` times each whole test process from outside, at two repeat counts. Without
//! `GRAPH_LAYOUT_BENCH_GRAPH` the test does nothing. `relayout_workload_is_timed` (Phase 7, S12) is the one test that
//! reads a clock inside the process: it times single calls, so it needs the clock that the core must not read.

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use super::layout;
use super::tests::assert_layout_gate;
use crate::engine::handle::{Engine, Generation};
use crate::engine::keys::Stage;
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

/// The `p`th percentile of `sorted` (nearest rank, `p` in percent): the smallest value at or above `p` of the samples.
fn percentile(sorted: &[Duration], p: usize) -> Duration {
    let rank = (sorted.len() * p).div_ceil(100).max(1);
    sorted[rank - 1]
}

/// The timings of the relayouts (Phase 7, S12): p50 and p95 of a full layout from a fresh engine, of a placement-only
/// relayout (`spacing.node` alternates, so each call re-runs Place and Route), and of a build-onward relayout
/// (`spacing.edge` alternates, so each call re-runs Build, Order, Place and Route). The first relayout of each kind is a
/// warm-up and is not timed. Each relayout is checked against the stages it must re-run. The layout of the last
/// placement-only relayout must equal a fresh `layout` on the same options. It prints one line per kind, in milliseconds.
/// Without `GRAPH_LAYOUT_BENCH_GRAPH` the test does nothing. `GRAPH_LAYOUT_BENCH_SAMPLES` is the number of timed calls
/// of each kind (default 30).
#[test]
#[expect(
    clippy::disallowed_methods,
    reason = "a benchmark reads the clock to time its calls; nothing it times reaches the layout, which reads no clock"
)]
fn relayout_workload_is_timed() {
    let Some(path) = std::env::var_os("GRAPH_LAYOUT_BENCH_GRAPH") else {
        return;
    };
    let effort = std::env::var("GRAPH_LAYOUT_BENCH_EFFORT")
        .expect("GRAPH_LAYOUT_BENCH_EFFORT is set with the workload");
    let samples: usize = std::env::var("GRAPH_LAYOUT_BENCH_SAMPLES")
        .map_or(Ok(30), |text| text.parse())
        .expect("GRAPH_LAYOUT_BENCH_SAMPLES is a count");
    let text = std::fs::read_to_string(&path).expect("the benchmark graph is readable");
    let graph = parse_graph(&text);
    let base = baseline_options(&effort);
    assert_layout_gate(&graph, &base);

    let mut full = Vec::with_capacity(samples);
    for _ in 0..samples {
        let engine = Engine::new();
        // ast-grep-ignore: rust-graph-layout-deterministic -- the test times the full layout; the clock reaches no layout
        let start = Instant::now();
        let progress = engine
            .layout(&graph, &base, Generation::new(1))
            .expect("the benchmark graph lays out")
            .expect("no newer generation has started");
        full.push(start.elapsed());
        assert_eq!(
            progress.reran(),
            Stage::ALL.as_slice(),
            "a fresh engine runs every stage"
        );
    }

    // The baseline's spacing, with `node` and `edge` set: the other fields keep the baseline's values.
    let with_spacing = |node: f64, edge: f64| {
        let mut options = base.clone();
        let spacing = options.spacing.get_or_insert_with(PartialSpacing::default);
        spacing.node = Some(node);
        spacing.edge = Some(edge);
        options
    };
    let engine = Engine::new();
    let mut generation = 0;
    let mut run = |options: &Options, expected: &[Stage]| {
        generation += 1;
        // ast-grep-ignore: rust-graph-layout-deterministic -- the test times the relayout; the clock reaches no layout
        let start = Instant::now();
        let progress = engine
            .layout(&graph, options, Generation::new(generation))
            .expect("the benchmark graph lays out")
            .expect("no newer generation has started");
        let elapsed = start.elapsed();
        assert_eq!(
            progress.reran(),
            expected,
            "the relayout re-runs other stages"
        );
        (elapsed, progress.into_layout())
    };
    run(&base, Stage::ALL.as_slice());

    let placed = [Stage::Place, Stage::Route];
    run(&with_spacing(30.0, 6.0), &placed);
    let mut placement = Vec::with_capacity(samples);
    let mut last = None;
    for i in 0..samples {
        let options = with_spacing(if i % 2 == 0 { 28.0 } else { 30.0 }, 6.0);
        let (elapsed, layout) = run(&options, &placed);
        placement.push(elapsed);
        last = Some((options, layout));
    }
    let (options, layout) = last.expect("at least one timed call");
    assert_eq!(
        layout,
        super::layout(&graph, &options).expect("the benchmark graph lays out"),
        "the placement-only relayout differs from a fresh layout"
    );

    let build_onward = [Stage::Build, Stage::Order, Stage::Place, Stage::Route];
    run(&with_spacing(28.0, 7.0), &build_onward);
    let mut build = Vec::with_capacity(samples);
    for i in 0..samples {
        let options = with_spacing(28.0, if i % 2 == 0 { 6.0 } else { 7.0 });
        build.push(run(&options, &build_onward).0);
    }

    for (kind, mut times) in [
        ("full", full),
        ("placement", placement),
        ("build-onward", build),
    ] {
        times.sort_unstable();
        println!(
            "relayout-bench {effort} {kind} samples {} p50 {:.2} ms p95 {:.2} ms nodes {} edges {}",
            times.len(),
            percentile(&times, 50).as_secs_f64() * 1000.0,
            percentile(&times, 95).as_secs_f64() * 1000.0,
            graph.nodes.id.len(),
            graph.edges.id.len(),
        );
    }
}
