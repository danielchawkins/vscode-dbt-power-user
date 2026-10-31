//! Placement against TypeScript: the outcome gate of the rows placement (ADR 0011, O-6). Each case of
//! `fixtures/parity/place.txt` (`print-fixtures.mjs place`) states TypeScript's full placement input: the ranks and their
//! order, each layered node's size, block, clusters and hint, the segments, the cluster spines and the options. The Rust
//! side builds the in-rank problem with `problem_of`, runs `place::place` on it, and checks the outcome:
//!
//! - a second run is equal to the first (determinism);
//! - each rank keeps its order and the separation of `problem.gap_left`, and no two real nodes overlap;
//! - `exactSeparations` solves to TypeScript's optimum vector, bit for bit: the one bit-exact result;
//! - the bounds (real node rectangles and cluster boxes) and the placement edge length are no larger than
//!   TypeScript's, within `RELATIVE_TOLERANCE`.
//!
//! The placement edge length is the placement-level measure of the fixture (port-to-port distance, not the routed
//! length of route, which a later phase builds). The finance graph is checked the same way when
//! `GRAPH_LAYOUT_PLACE_FINANCE` names its dump (`print-fixtures.mjs place-finance <manifest>`); the test is skipped when
//! the variable is unset.

use crate::place::{
    ClusterSpec, Hint, Layered, LayeredNode, LinkOptions, Mode, PlaceInput, Placement, Point,
    Segment, Spacing, place, problem_of,
};
use crate::solve::Separation;
use crate::testkit::solve::exact_solution;

const FIXTURE: &str = include_str!("../fixtures/parity/place.txt");
const FINANCE_VARIABLE: &str = "GRAPH_LAYOUT_PLACE_FINANCE";

/// The slack allowed on a separation and on an overlap, in drawing units. The solver meets its constraints to rounding.
const SEPARATION_TOLERANCE: f64 = 1e-9;

/// The relative slack allowed on a bound and on the edge length against TypeScript's. It is not widened for a case: a
/// case worse than this is a finding, recorded in the test output.
const RELATIVE_TOLERANCE: f64 = 1e-9;

/// One layered node, as the fixture states it.
struct Node {
    rank: usize,
    id: Option<String>,
    breadth: f64,
    width: f64,
    height: f64,
    block: usize,
    anchored: bool,
    path: Vec<usize>,
    hint: Option<Hint>,
}

/// `exactSeparations` on one instance, with TypeScript's optimum.
struct Exact {
    x0: Vec<f64>,
    weight: Vec<f64>,
    seps: Vec<Separation>,
    optimum: Vec<f64>,
}

/// TypeScript's outputs of the placement: the node points, the bounds as `minx,miny,maxx,maxy` (absent when there are
/// no rectangles) and the placement edge length. The work count is not gated: it is a cost, not an outcome.
struct Expect {
    points: Vec<(f64, f64)>,
    bounds: Option<[f64; 4]>,
    edge_length: f64,
}

/// One placement case: its input and TypeScript's outputs.
struct Case {
    name: String,
    down: bool,
    mode: Mode,
    ranks: usize,
    iterations: usize,
    spacing_node: f64,
    spacing_edge: f64,
    spacing: Spacing,
    anchor: Option<String>,
    stability: Option<f64>,
    clusters: Vec<ClusterSpec>,
    nodes: Vec<Node>,
    layers: Vec<Vec<usize>>,
    segments: Vec<Segment>,
    spines: Vec<Vec<usize>>,
    exact: Option<Exact>,
    expect: Expect,
}

/// The worst outcome of a case, for the findings: TypeScript's value and Rust's, by metric.
struct Finding {
    name: String,
    metric: &'static str,
    typescript: f64,
    rust: f64,
}

/// A previous placement's hex bit pattern.
fn float(hex: &str) -> f64 {
    f64::from_bits(u64::from_str_radix(hex, 16).expect("hex bits"))
}

fn bits_list(text: &str) -> Vec<f64> {
    if text == "-" {
        return Vec::new();
    }
    text.split(',').map(float).collect()
}

fn index_list(text: &str) -> Vec<usize> {
    if text == "-" {
        return Vec::new();
    }
    text.split(',')
        .map(|i| i.parse().expect("an index"))
        .collect()
}

fn optional_bits(text: &str) -> Option<f64> {
    (text != "-").then(|| float(text))
}

fn optional_id(text: &str) -> Option<String> {
    (text != "-").then(|| text.to_string())
}

/// The `key=value` fields of a line, after its keyword.
fn fields<'a>(words: &[&'a str]) -> Vec<(&'a str, &'a str)> {
    words
        .iter()
        .map(|w| w.split_once('=').expect("a key=value field"))
        .collect()
}

fn value<'a>(fields: &[(&str, &'a str)], key: &str) -> &'a str {
    fields
        .iter()
        .find(|(k, _)| *k == key)
        .map_or_else(|| panic!("a field `{key}`"), |(_, v)| *v)
}

fn parse_points(text: &str) -> Vec<(f64, f64)> {
    if text == "-" {
        return Vec::new();
    }
    text.split(';')
        .map(|p| {
            let (x, y) = p.split_once(',').expect("a point");
            (float(x), float(y))
        })
        .collect()
}

fn parse_bounds(text: &str) -> Option<[f64; 4]> {
    if text == "-" {
        return None;
    }
    let v = bits_list(text);
    Some([v[0], v[1], v[2], v[3]])
}

fn parse_exact(words: &[&str]) -> Option<Exact> {
    if words == ["-"] {
        return None;
    }
    let f = fields(words);
    let seps = value(&f, "seps")
        .split(';')
        .map(|s| {
            let (ends, gap) = s.split_once('@').expect("a separation");
            let (from, to) = ends.split_once('>').expect("a separation's ends");
            Separation {
                from: from.parse().expect("a variable"),
                to: to.parse().expect("a variable"),
                gap: float(gap),
            }
        })
        .collect();
    Some(Exact {
        x0: bits_list(value(&f, "x0")),
        weight: bits_list(value(&f, "weight")),
        seps,
        optimum: bits_list(value(&f, "optimum")),
    })
}

/// Parses the cases of a fixture: each `case` line starts one, and the lines that follow it belong to it.
fn parse_cases(text: &str) -> Vec<Case> {
    let mut cases: Vec<Case> = Vec::new();
    for line in text.lines() {
        if line.starts_with('#') || line.trim().is_empty() {
            continue;
        }
        let words: Vec<&str> = line.split_whitespace().collect();
        let rest = &words[1..];
        match words[0] {
            "case" => cases.push(parse_case_header(rest)),
            keyword => {
                let case = cases.last_mut().expect("a case line comes first");
                parse_line(case, keyword, rest);
            }
        }
    }
    cases
}

fn parse_case_header(words: &[&str]) -> Case {
    let f = fields(words);
    let spacing = bits_list(value(&f, "spacing"));
    let (node, edge, rank, cluster) = (spacing[0], spacing[1], spacing[2], spacing[3]);
    Case {
        name: value(&f, "name").to_string(),
        down: value(&f, "direction") == "down",
        mode: match value(&f, "mode") {
            "rows" => Mode::Rows,
            "levels" => Mode::Levels,
            other => panic!("an unknown mode `{other}`"),
        },
        ranks: value(&f, "ranks").parse().expect("a rank count"),
        iterations: value(&f, "iterations").parse().expect("an iteration count"),
        spacing_node: node,
        spacing_edge: edge,
        spacing: Spacing {
            node,
            edge,
            rank,
            cluster,
        },
        anchor: optional_id(value(&f, "anchor")),
        stability: optional_bits(value(&f, "stability")),
        clusters: Vec::new(),
        nodes: Vec::new(),
        layers: Vec::new(),
        segments: Vec::new(),
        spines: Vec::new(),
        exact: None,
        expect: Expect {
            points: Vec::new(),
            bounds: None,
            edge_length: 0.0,
        },
    }
}

fn parse_line(case: &mut Case, keyword: &str, words: &[&str]) {
    match keyword {
        "cluster" => {
            let f = fields(words);
            case.clusters.push(ClusterSpec {
                id: value(&f, "id").to_string(),
                parent: optional_index(value(&f, "parent")),
                padding: optional_bits(value(&f, "padding")),
                label_height: optional_bits(value(&f, "label")),
            });
        }
        "node" => {
            let f = fields(words);
            let hint = optional_bits_pair(value(&f, "hint"));
            case.nodes.push(Node {
                rank: value(&f, "rank").parse().expect("a rank"),
                id: optional_id(value(&f, "id")),
                breadth: float(value(&f, "breadth")),
                width: float(value(&f, "width")),
                height: float(value(&f, "height")),
                block: value(&f, "block").parse().expect("a block"),
                anchored: value(&f, "anchored") == "1",
                path: index_list(value(&f, "path")),
                hint,
            });
        }
        "layer" => case.layers.push(index_list(words[1])),
        "spine" => case.spines.push(index_list(words[0])),
        "segment" => {
            let f = fields(words);
            case.segments.push(Segment {
                top: value(&f, "top").parse().expect("a node"),
                bottom: value(&f, "bottom").parse().expect("a node"),
                weight: float(value(&f, "weight")),
                top_offset: float(value(&f, "top_offset")),
                bottom_offset: float(value(&f, "bottom_offset")),
                directed: value(&f, "directed") == "1",
            });
        }
        "exact" => case.exact = parse_exact(words),
        "expect" => {
            let f = fields(words);
            case.expect = Expect {
                points: parse_points(value(&f, "points")),
                bounds: parse_bounds(value(&f, "bounds")),
                edge_length: float(value(&f, "edge_length")),
            };
        }
        other => panic!("an unknown fixture line `{other}`"),
    }
}

fn optional_index(text: &str) -> Option<usize> {
    (text != "-").then(|| text.parse().expect("an index"))
}

fn optional_bits_pair(text: &str) -> Option<Hint> {
    if text == "-" {
        return None;
    }
    let v = bits_list(text);
    Some(Hint { x: v[0], y: v[1] })
}

/// The placement of a case, and the separation gap of each layered node.
fn solve(case: &Case) -> (Vec<f64>, Placement) {
    let ids: Vec<Option<&str>> = case.nodes.iter().map(|n| n.id.as_deref()).collect();
    let layered_nodes: Vec<LayeredNode<'_>> = case
        .nodes
        .iter()
        .zip(&ids)
        .map(|(n, &id)| LayeredNode {
            id,
            breadth: n.breadth,
            block: n.block,
            anchored: n.anchored,
            hint: n.hint,
        })
        .collect();
    let problem = problem_of(
        &Layered {
            layers: &case.layers,
            nodes: &layered_nodes,
            segments: &case.segments,
            spines: &case.spines,
        },
        &LinkOptions {
            anchor: case.anchor.as_deref(),
            stability: case.stability.unwrap_or(1.0),
            down: case.down,
            spacing_node: case.spacing_node,
            spacing_edge: case.spacing_edge,
        },
    );
    let node_ranks: Vec<usize> = case.nodes.iter().map(|n| n.rank).collect();
    let paths: Vec<Vec<usize>> = case.nodes.iter().map(|n| n.path.clone()).collect();
    let in_rank_half: Vec<f64> = case.nodes.iter().map(|n| n.breadth / 2.0).collect();
    let across_extent: Vec<f64> = case
        .nodes
        .iter()
        .map(|n| if case.down { n.height } else { n.width })
        .collect();
    let hints: Vec<Option<Hint>> = case.nodes.iter().map(|n| n.hint).collect();
    let input = PlaceInput {
        problem: &problem,
        ranks: case.ranks,
        node_ranks: &node_ranks,
        segments: &case.segments,
        paths: &paths,
        clusters: &case.clusters,
        in_rank_half: &in_rank_half,
        across_extent: &across_extent,
        ids: &ids,
        hints: &hints,
        anchor: case.anchor.as_deref(),
        down: case.down,
        spacing: case.spacing,
        iterations: case.iterations,
        mode: case.mode,
        stability: case.stability.unwrap_or(1.0),
    };
    let placement =
        place(&input).unwrap_or_else(|e| panic!("{}: placement failed: {e:?}", case.name));
    (problem.gap_left.clone(), placement)
}

/// The coordinate along the ranks, and across them.
fn along(point: Point, down: bool) -> f64 {
    if down { point.x } else { point.y }
}

fn across(point: Point, down: bool) -> f64 {
    if down { point.y } else { point.x }
}

/// Each real node's rectangle as `(minx, miny, maxx, maxy)`, in the printer's arithmetic: the centre less the half
/// extent, and the far edge as the near edge plus twice the half.
fn node_rects(case: &Case, points: &[Point]) -> Vec<[f64; 4]> {
    let mut rects = Vec::new();
    for (node, point) in case.nodes.iter().zip(points) {
        if node.id.is_none() {
            continue;
        }
        let half_along = node.breadth / 2.0;
        let extent = if case.down { node.height } else { node.width };
        let half_across = extent / 2.0;
        let (ax, ac) = (along(*point, case.down), across(*point, case.down));
        let (x0, y0) = if case.down {
            (ax - half_along, ac - half_across)
        } else {
            (ac - half_across, ax - half_along)
        };
        let (w, h) = if case.down {
            (2.0 * half_along, 2.0 * half_across)
        } else {
            (2.0 * half_across, 2.0 * half_along)
        };
        rects.push([x0, y0, x0 + w, y0 + h]);
    }
    rects
}

/// The bounds of the real node rectangles and the cluster boxes, `None` when there are none.
fn bounds_of(case: &Case, placement: &Placement) -> Option<[f64; 4]> {
    let mut rects = node_rects(case, &placement.points);
    for b in crate::place::boxes(placement) {
        rects.push([b.x, b.y, b.x + b.width, b.y + b.height]);
    }
    if rects.is_empty() {
        return None;
    }
    let mut out = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for r in &rects {
        out[0] = out[0].min(r[0]);
        out[1] = out[1].min(r[1]);
        out[2] = out[2].max(r[2]);
        out[3] = out[3].max(r[3]);
    }
    Some(out)
}

/// The placement edge length: each segment's port-to-port distance, summed in segment order.
fn edge_length(case: &Case, points: &[Point]) -> f64 {
    let mut length = 0.0;
    for s in &case.segments {
        let top = points[s.top];
        let bottom = points[s.bottom];
        let dx =
            along(bottom, case.down) + s.bottom_offset - (along(top, case.down) + s.top_offset);
        let dy = across(bottom, case.down) - across(top, case.down);
        length += (dx * dx + dy * dy).sqrt();
    }
    length
}

/// Each rank keeps its order and every gap of `gap_left`, and no two real nodes overlap.
fn assert_valid(case: &Case, gap_left: &[f64], points: &[Point]) {
    for layer in &case.layers {
        for pair in layer.windows(2) {
            let (u, v) = (pair[0], pair[1]);
            let sep = along(points[v], case.down) - along(points[u], case.down);
            assert!(
                sep >= gap_left[v] - SEPARATION_TOLERANCE,
                "{}: nodes {u} and {v} are {sep} apart, below their gap {}",
                case.name,
                gap_left[v]
            );
        }
    }
    let real: Vec<usize> = (0..case.nodes.len())
        .filter(|&i| case.nodes[i].id.is_some())
        .collect();
    for (k, &i) in real.iter().enumerate() {
        for &j in &real[k + 1..] {
            let (ni, nj) = (&case.nodes[i], &case.nodes[j]);
            let (ei, ej) = if case.down {
                (ni.height, nj.height)
            } else {
                (ni.width, nj.width)
            };
            let along_gap = (along(points[i], case.down) - along(points[j], case.down)).abs();
            let across_gap = (across(points[i], case.down) - across(points[j], case.down)).abs();
            let overlap_along = ni.breadth / 2.0 + nj.breadth / 2.0 - along_gap;
            let overlap_across = ei / 2.0 + ej / 2.0 - across_gap;
            assert!(
                !(overlap_along > SEPARATION_TOLERANCE && overlap_across > SEPARATION_TOLERANCE),
                "{}: real nodes {i} and {j} overlap",
                case.name
            );
        }
    }
}

/// `exactSeparations` solves to TypeScript's optimum vector, bit for bit.
fn assert_exact(case: &Case) {
    let Some(exact) = &case.exact else {
        return;
    };
    let (x, _) = exact_solution(&exact.x0, &exact.weight, &exact.seps);
    assert_eq!(x.len(), exact.optimum.len(), "{}: exact size", case.name);
    for (k, (a, b)) in x.iter().zip(&exact.optimum).enumerate() {
        assert_eq!(
            a.to_bits(),
            b.to_bits(),
            "{}: exact optimum at variable {k}",
            case.name
        );
    }
}

/// Records each metric where Rust is larger than TypeScript beyond the tolerance.
fn compare(case: &Case, placement: &Placement, findings: &mut Vec<Finding>) {
    let rust_bounds = bounds_of(case, placement);
    if let (Some(ts), Some(rs)) = (case.expect.bounds, rust_bounds) {
        let ts_w = ts[2] - ts[0];
        let ts_h = ts[3] - ts[1];
        let rs_w = rs[2] - rs[0];
        let rs_h = rs[3] - rs[1];
        for (metric, ts_value, rs_value) in [("width", ts_w, rs_w), ("height", ts_h, rs_h)] {
            if rs_value > ts_value * (1.0 + RELATIVE_TOLERANCE) {
                findings.push(Finding {
                    name: case.name.clone(),
                    metric,
                    typescript: ts_value,
                    rust: rs_value,
                });
            }
        }
    }
    let length = edge_length(case, &placement.points);
    if length > case.expect.edge_length * (1.0 + RELATIVE_TOLERANCE) {
        findings.push(Finding {
            name: case.name.clone(),
            metric: "edge length",
            typescript: case.expect.edge_length,
            rust: length,
        });
    }
}

/// Checks one case; returns the metrics where Rust is worse than TypeScript.
fn check_case(case: &Case) -> Vec<Finding> {
    let (gap_left, placement) = solve(case);
    let (_, again) = solve(case);
    assert_eq!(placement, again, "{}: two runs differ", case.name);
    assert_eq!(
        placement.points.len(),
        case.expect.points.len(),
        "{}: node count",
        case.name
    );
    assert_valid(case, &gap_left, &placement.points);
    assert_exact(case);
    let mut findings = Vec::new();
    compare(case, &placement, &mut findings);
    findings
}

/// Prints the cases where Rust is worse than TypeScript, so that a finding is recorded with its numbers.
fn report(label: &str, cases: usize, findings: &[Finding]) {
    println!(
        "place {label}: {cases} cases, {} metrics worse than TypeScript",
        findings.len()
    );
    for f in findings {
        println!(
            "place {label}: {} {} typescript={} rust={}",
            f.name, f.metric, f.typescript, f.rust
        );
    }
}

#[test]
fn placements_are_valid_deterministic_and_no_worse_than_typescript_on_the_fixture() {
    let cases = parse_cases(FIXTURE);
    assert!(!cases.is_empty(), "the fixture holds cases");
    let findings: Vec<Finding> = cases.iter().flat_map(check_case).collect();
    report("fixture", cases.len(), &findings);
    assert!(
        findings.is_empty(),
        "{} metrics are worse than TypeScript beyond the tolerance",
        findings.len()
    );
}

#[test]
fn placements_are_valid_deterministic_and_no_worse_than_typescript_on_the_finance_graph() {
    let Some(path) = std::env::var_os(FINANCE_VARIABLE) else {
        return;
    };
    let text = std::fs::read_to_string(&path).expect("the finance placement dump is readable");
    let cases = parse_cases(&text);
    assert!(!cases.is_empty(), "the finance dump holds cases");
    let findings: Vec<Finding> = cases.iter().flat_map(check_case).collect();
    report("finance", cases.len(), &findings);
    assert!(
        findings.is_empty(),
        "{} metrics are worse than TypeScript beyond the tolerance",
        findings.len()
    );
}

/// The bits of each value, `;`-free and comma-separated, or `-` for none.
fn bits_text(values: &[f64]) -> String {
    if values.is_empty() {
        return "-".to_string();
    }
    values
        .iter()
        .map(|v| format!("{:016x}", v.to_bits()))
        .collect::<Vec<_>>()
        .join(",")
}

/// One output line: the case's name, then its placement as IEEE bits: the points, the bounds, the placement edge length,
/// the work count and the exact optimum (when the case has an instance).
fn output_line(case: &Case) -> String {
    let (_, placement) = solve(case);
    let points: Vec<String> = placement
        .points
        .iter()
        .map(|p| format!("{:016x},{:016x}", p.x.to_bits(), p.y.to_bits()))
        .collect();
    let bounds = bounds_of(case, &placement).map_or_else(|| "-".to_string(), |b| bits_text(&b));
    let exact = case.exact.as_ref().map_or_else(
        || "-".to_string(),
        |e| bits_text(&exact_solution(&e.x0, &e.weight, &e.seps).0),
    );
    let length = edge_length(case, &placement.points).to_bits();
    format!(
        "{}\tpoints={}\tbounds={}\tedge_length={length:016x}\twork={}\texact={}",
        case.name,
        points.join(";"),
        bounds,
        placement.work,
        exact
    )
}

/// The timed placement workload: one finance or synthetic case, written by `scripts/bench/place-timings.mjs` from the
/// TypeScript run. The test checks the first placement's points against TypeScript's bit for bit, then places the case
/// `GRAPH_LAYOUT_PLACE_REPEATS` more times. The timed work is `solve` (the problem and the placement), as in TypeScript.
#[test]
fn place_timing_workload_runs() {
    let Some(path) = std::env::var_os("GRAPH_LAYOUT_PLACE_TIMING") else {
        return;
    };
    let repeats: u32 = std::env::var("GRAPH_LAYOUT_PLACE_REPEATS")
        .expect("GRAPH_LAYOUT_PLACE_REPEATS is set with the workload")
        .parse()
        .expect("GRAPH_LAYOUT_PLACE_REPEATS is a count");
    let text = std::fs::read_to_string(&path).expect("the timing workload is readable");
    let cases = parse_cases(&text);
    assert_eq!(cases.len(), 1, "a timing workload holds one case");
    let case = &cases[0];
    let (_, first) = solve(case);
    let same = first.points.len() == case.expect.points.len()
        && first
            .points
            .iter()
            .zip(&case.expect.points)
            .all(|(p, &(x, y))| p.x.to_bits() == x.to_bits() && p.y.to_bits() == y.to_bits());
    assert!(same, "{}: the placement differs from TypeScript", case.name);
    println!("place-timing: points match TypeScript");
    for _ in 0..repeats {
        std::hint::black_box(solve(case));
    }
}

/// The placement outputs: each case of `place.txt` as `output_line` writes it. The test runs natively and under WASI and
/// writes the output when `GRAPH_LAYOUT_PLACE_OUT` names a file; `just place-parity` compares the two files byte for byte.
/// When `GRAPH_LAYOUT_PLACE_FINANCE` and `GRAPH_LAYOUT_PLACE_FINANCE_OUT` both name files, the finance cases are written
/// the same way, so a discrepancy report can read their bounds, edge lengths and work against TypeScript's.
#[test]
fn place_outputs_are_written_for_the_parity_comparison() {
    if let Some(path) = std::env::var_os("GRAPH_LAYOUT_PLACE_OUT") {
        let mut text = String::new();
        for case in parse_cases(FIXTURE) {
            text.push_str(&output_line(&case));
            text.push('\n');
        }
        std::fs::write(&path, text).expect("the place output is writable");
    }
    let (Some(dump), Some(out)) = (
        std::env::var_os(FINANCE_VARIABLE),
        std::env::var_os("GRAPH_LAYOUT_PLACE_FINANCE_OUT"),
    ) else {
        return;
    };
    let text = std::fs::read_to_string(&dump).expect("the finance placement dump is readable");
    let mut lines = String::new();
    for case in parse_cases(&text) {
        lines.push_str(&output_line(&case));
        lines.push('\n');
    }
    std::fs::write(&out, lines).expect("the finance placement output is writable");
}
