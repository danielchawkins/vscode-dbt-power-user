//! Ordering against TypeScript. The crossings oracle: `total_crossings` and `exact_minimum_crossings` on the seeded
//! random layered graphs of `fixtures/parity/crossings.txt`, which `print-fixtures.mjs crossings` wrote from
//! `totalCrossings` and `exactMinimumCrossings` on the same graphs. The Rust side replays the draws of
//! `randomCrossingCase`, so a difference shows as a bit difference.
//!
//! The order gate is an outcome gate (ADR 0011, O-6), not bit equality. Each case of `fixtures/parity/order.txt` (the
//! layering cases: the package graphs, the negative-zero bands and seeded random graphs) and the finance graph, when
//! `GRAPH_LAYOUT_ORDER_FINANCE` names its dump (`print-fixtures.mjs order-finance <manifest>`), is ranked, layered and
//! built here (`rank`, `layer`, `engine::layered::build`), then ordered at each effort, unhinted and hinted. Every order
//! must be valid and two runs must be equal, and its crossings, counted by the Fenwick count, must be no more than
//! TypeScript's crossings for the same input. The order itself is not compared: a better order is allowed.

use crate::budget::Budget;
use crate::engine::layered::build;
use crate::index::Indexed;
use crate::layering::{
    EdgeRule, LayeredGraph, LayeredNode, PartitionMode, RankOptions, Scratch, Segment, layer, rank,
};
use crate::model::{Clusters, Direction, Edges, Graph, Nodes, Options, Ports};
use crate::order::{Hints, OrderModel, exact_minimum_crossings, order, total_crossings};
use crate::rand::Mulberry32;

const FIXTURE: &str = include_str!("../fixtures/parity/crossings.txt");
const ORDER_FIXTURE: &str = include_str!("../fixtures/parity/order.txt");
/// The finance dump of `print-fixtures.mjs order-finance`, read only when this variable names it.
const FINANCE_VARIABLE: &str = "GRAPH_LAYOUT_ORDER_FINANCE";

/// The cases of `order.txt`: the 4 package and negative-zero cases and the 300 seeded random layering cases.
const ORDER_CASES: usize = 304;
/// The results of one case: each of the three efforts, unhinted and hinted.
const RESULTS_PER_CASE: usize = 6;
/// The size of the finance dump: its nodes and its edges, as `financeGraph(manifest)` gives them. The test fails when the
/// dump has another size, so the size of the graph the report quotes cannot drift from the dump.
const FINANCE_NODES: usize = 1127;
const FINANCE_EDGES: usize = 1291;
/// Relative rounding allowed in a crossing count.
const ROUNDING: f64 = 1e-12;

/// The number of seeded cases in the fixture, and how many of them have a fractional crossing count (a `.5`-weight link
/// makes one): the fractional sums are the reason the Fenwick tree stores `f64`.
const CASES: usize = 200;
const FRACTIONAL_CASES: usize = 1;

/// A draw of `0..k`: `u32 % k`, the integer `pick` of `print-fixtures.mjs`.
fn pick(random: &mut Mulberry32, k: usize) -> usize {
    usize::try_from(random.next_u32()).expect("u32 fits in usize") % k
}

/// `randomCrossingCase(seed)` of `print-fixtures.mjs`: the layered graph and its starting order.
fn random_case(seed: u32) -> (LayeredGraph, Vec<Vec<usize>>) {
    let mut random = Mulberry32::new(seed);
    let ranks = 2 + pick(&mut random, 3);
    let count = 3 + pick(&mut random, 7);
    let mut rank_of = Vec::with_capacity(count);
    let mut breadth_of = Vec::with_capacity(count);
    for _ in 0..count {
        rank_of.push(pick(&mut random, ranks));
        breadth_of.push(1 + pick(&mut random, 3));
    }
    let mut segments = Vec::new();
    let candidates = pick(&mut random, 2 * count);
    for _ in 0..candidates {
        let top = pick(&mut random, count);
        let below: Vec<usize> = (0..count)
            .filter(|&i| rank_of[i] == rank_of[top] + 1)
            .collect();
        let pick_below = pick(&mut random, below.len().max(1));
        let weight = [0.5, 1.0, 1.5, 2.25][pick(&mut random, 4)];
        let top_offset = random.next_f64() * 4.0 - 2.0;
        let bottom_offset = random.next_f64() * 4.0 - 2.0;
        if let Some(&bottom) = below.get(pick_below) {
            segments.push(Segment {
                top,
                bottom,
                weight,
                top_offset,
                bottom_offset,
            });
        }
    }
    let layers: Vec<Vec<usize>> = (0..ranks)
        .map(|rank| {
            let items: Vec<usize> = (0..count).filter(|&i| rank_of[i] == rank).collect();
            random.shuffled(&items)
        })
        .collect();
    let nodes = (0..count)
        .map(|x| LayeredNode {
            id: Some(x),
            rank: rank_of[x],
            breadth: f64::from(u32::try_from(breadth_of[x]).expect("small")),
            port: None,
        })
        .collect();
    let graph = LayeredGraph {
        nodes,
        segments,
        block: (0..count).collect(),
        paths: vec![Vec::new(); count],
        spines: Vec::new(),
        ranks,
    };
    (graph, layers)
}

/// The fixture's spelling of a layering: ranks joined by `;`, nodes by `,`, an empty rank as `-`.
fn render(layers: &[Vec<usize>]) -> String {
    layers
        .iter()
        .map(|layer| {
            if layer.is_empty() {
                "-".to_owned()
            } else {
                layer
                    .iter()
                    .map(usize::to_string)
                    .collect::<Vec<_>>()
                    .join(",")
            }
        })
        .collect::<Vec<_>>()
        .join(";")
}

fn bits(x: f64) -> String {
    format!("{:016x}", x.to_bits())
}

#[test]
fn crossings_and_exact_minimums_match_typescript_bit_for_bit() {
    let mut checked = 0;
    let mut fractional = 0;
    for line in FIXTURE.lines().filter(|line| line.starts_with("case ")) {
        let fields: Vec<&str> = line.split(' ').collect();
        let seed: u32 = fields[1].parse().expect("fixture seed is a u32");
        let (graph, layers) = random_case(seed);
        assert_eq!(
            render(&layers),
            fields[2],
            "seed {seed}: the starting order"
        );
        let model = OrderModel::new(&graph, layers.clone());
        let crossings = total_crossings(&model);
        assert_eq!(bits(crossings), fields[3], "seed {seed}: crossings");
        if crossings.fract() != 0.0 {
            fractional += 1;
        }
        let exact = exact_minimum_crossings(&graph, &layers)
            .expect("the fixture graphs are within the exact limit");
        assert_eq!(
            bits(exact.crossings),
            fields[4],
            "seed {seed}: exact minimum"
        );
        checked += 1;
    }
    assert_eq!(checked, CASES, "every case of the fixture is checked");
    assert!(
        fractional >= FRACTIONAL_CASES,
        "the fixture has fractional crossing counts"
    );
}

/// `randomHints(seed, layered)` of `order-fixtures.mjs`: node i's order is `u32 % 4` of the draws of
/// `Mulberry32::new(seed + 1000003)`, one draw per node in node order.
fn random_hints(seed: u32, count: usize) -> Hints {
    let mut random = Mulberry32::new(seed + 1_000_003);
    (0..count)
        .map(|i| {
            let drawn = f64::from(u32::try_from(pick(&mut random, 4)).expect("a draw below 4"));
            (i, drawn)
        })
        .collect()
}

/// One TypeScript result of a case: the effort, whether the order had hints, and TypeScript's crossings.
#[derive(Debug)]
struct Expected {
    effort: String,
    hinted: bool,
    crossings: f64,
}

/// One case of an ordering fixture: its input as `order-fixtures.mjs` writes it, and TypeScript's results for it.
#[derive(Debug)]
struct Case {
    name: String,
    seed: u32,
    mode: PartitionMode,
    bands: Vec<Option<f64>>,
    widths: Vec<f64>,
    ends: Vec<(usize, usize)>,
    rules: Vec<EdgeRule>,
    results: Vec<Expected>,
}

/// A floating-point value as the IEEE bits `bitsHex` prints.
fn float(hex: &str) -> f64 {
    f64::from_bits(u64::from_str_radix(hex, 16).expect("hex bits"))
}

/// A decimal number as `String(number)` prints it, as the rules of `edgeRules` write their minimum length and weight.
fn decimal(text: &str) -> f64 {
    text.parse().expect("a decimal number")
}

fn parse_mode(text: &str) -> PartitionMode {
    match text {
        "none" => PartitionMode::None,
        "soft" => PartitionMode::Soft,
        "strict" => PartitionMode::Strict,
        other => panic!("unknown partition mode {other}"),
    }
}

/// One `case` line: `case<TAB>name<TAB>seed<TAB>mode<TAB>bands<TAB>widths<TAB>edges<TAB>results`, with `-` for an empty
/// list. Bands and widths are comma-separated IEEE bits (a band of `-` is none); each edge is
/// `source:target:kind:ranks:minLength:weight`; each result is `effort:hinted:crossings`.
fn parse_case(line: &str) -> Case {
    let fields: Vec<&str> = line.split('\t').collect();
    assert_eq!(
        fields.len(),
        8,
        "a case line has eight tab-separated fields"
    );
    let bands = fields[4]
        .split(',')
        .map(|band| (band != "-").then(|| float(band)))
        .collect::<Vec<_>>();
    let widths: Vec<f64> = fields[5].split(',').map(float).collect();
    assert_eq!(widths.len(), bands.len(), "one width per node");
    let (mut ends, mut rules) = (Vec::new(), Vec::new());
    if fields[6] != "-" {
        for edge in fields[6].split(';') {
            let parts: Vec<&str> = edge.split(':').collect();
            assert_eq!(parts.len(), 6, "an edge has six fields");
            ends.push((
                parts[0].parse().expect("a node index"),
                parts[1].parse().expect("a node index"),
            ));
            rules.push(EdgeRule {
                kind: parts[2].parse().expect("a kind index"),
                ranks: parts[3] == "1",
                min_length: decimal(parts[4]),
                weight: decimal(parts[5]),
            });
        }
    }
    let results = fields[7]
        .split(',')
        .map(|result| {
            let parts: Vec<&str> = result.split(':').collect();
            assert_eq!(parts.len(), 3, "a result has three fields");
            Expected {
                effort: parts[0].to_owned(),
                hinted: parts[1] == "1",
                crossings: float(parts[2]),
            }
        })
        .collect();
    Case {
        name: fields[1].to_owned(),
        seed: fields[2].parse().expect("a seed is a u32"),
        mode: parse_mode(fields[3]),
        bands,
        widths,
        ends,
        rules,
        results,
    }
}

fn parse_cases(text: &str) -> Vec<Case> {
    text.lines()
        .filter(|line| line.starts_with("case\t"))
        .map(parse_case)
        .collect()
}

/// The graph that `layering` and `order` read for a case: its nodes with bands and widths, and its edges with their
/// kinds. The fixtures carry no ports and no clusters, so the graph has none. Heights are zero: only the right-to-left
/// direction reads them, and the case is laid out downward.
fn graph_of(case: &Case) -> Graph {
    let count = case.bands.len();
    let edges = case.ends.len();
    Graph {
        nodes: Nodes {
            id: (0..count).map(|i| format!("n{i}")).collect(),
            width: case.widths.clone(),
            height: vec![0.0; count],
            cluster: vec![None; count],
            partition: case.bands.clone(),
            ports: Ports::default(),
        },
        edges: Edges {
            id: (0..edges).map(|k| format!("e{k}")).collect(),
            source: case.ends.iter().map(|&(s, _)| format!("n{s}")).collect(),
            target: case.ends.iter().map(|&(_, t)| format!("n{t}")).collect(),
            source_port: vec![None; edges],
            target_port: vec![None; edges],
            kind: case.rules.iter().map(|r| format!("k{}", r.kind)).collect(),
        },
        clusters: Clusters::default(),
    }
}

/// The whole rank of each node, as the builder takes it. Ranks are whole numbers, and may have gaps (an empty rank is
/// a layer with no node); a rank that is not a whole number fails the check.
fn whole_ranks(ranks: &[f64]) -> Vec<usize> {
    ranks.iter().map(|&r| whole_rank(r)).collect()
}

fn whole_rank(r: f64) -> usize {
    let mut k = 0;
    while f64::from(u32::try_from(k).expect("a small rank")) < r {
        k += 1;
    }
    assert!(
        f64::from(u32::try_from(k).expect("a small rank")) - r == 0.0,
        "a rank is a whole number, got {r}"
    );
    k
}

/// What one run of the pipeline gives: the layered graph, the ordered layers and their crossings.
struct Run {
    layered: LayeredGraph,
    layers: Vec<Vec<usize>>,
    crossings: f64,
}

/// Ranks, lays out and orders one case at one result's effort and seed, with the hints of `randomHints` when it is
/// hinted.
fn run(case: &Case, expected: &Expected, seed: u32) -> Run {
    let budget = Budget::for_effort(Some(&expected.effort)).expect("a known effort");
    let graph = Indexed::from_ends(
        case.bands.len(),
        case.ends
            .iter()
            .map(|&(s, t)| {
                Some((
                    u32::try_from(s).expect("small"),
                    u32::try_from(t).expect("small"),
                ))
            })
            .collect(),
        &vec![true; case.ends.len()],
    );
    let options = RankOptions {
        partitions: case.mode,
        node_partition: &case.bands,
        edges: &case.rules,
        hints: &[],
        stability: 1.0,
        budget: &budget,
    };
    let ranking = rank(&graph, &options, &mut Scratch::default()).expect("the case ranks");
    let layers = layer(&graph, &case.rules, &ranking.ranks);
    let layered = build(
        &graph_of(case),
        &Options {
            direction: Direction::Down,
            ..Options::default()
        },
        &layers,
        &whole_ranks(&ranking.ranks),
    );
    let hints = expected
        .hinted
        .then(|| random_hints(case.seed, layered.nodes.len()));
    let ordered = order(&layered, hints.as_ref(), &budget, seed);
    let crossings = total_crossings(&OrderModel::new(&layered, ordered.layers.clone()));
    Run {
        layered,
        layers: ordered.layers,
        crossings,
    }
}

/// Every node of the layered graph is in exactly one layer, the layer of its rank, and there is one layer per rank.
fn assert_valid(layered: &LayeredGraph, layers: &[Vec<usize>], label: &str) {
    assert_eq!(layers.len(), layered.ranks, "{label}: one layer per rank");
    let mut seen = vec![false; layered.nodes.len()];
    for (rank, layer) in layers.iter().enumerate() {
        for &x in layer {
            assert!(x < seen.len(), "{label}: node {x} does not exist");
            assert!(!seen[x], "{label}: node {x} is in two layers");
            assert_eq!(
                layered.nodes[x].rank, rank,
                "{label}: node {x} is in the wrong rank"
            );
            seen[x] = true;
        }
    }
    assert!(seen.iter().all(|&s| s), "{label}: a node is in no layer");
}

/// Checks one case at every result. Returns how many results have fewer crossings than TypeScript's.
fn check_case(case: &Case) -> usize {
    let mut fewer = 0;
    for expected in &case.results {
        let label = format!(
            "{} seed {} {} hinted {}",
            case.name, case.seed, expected.effort, expected.hinted
        );
        let first = run(case, expected, case.seed);
        let second = run(case, expected, case.seed);
        assert_eq!(
            first.layers, second.layers,
            "{label}: two runs give different orders"
        );
        assert_eq!(
            bits(first.crossings),
            bits(second.crossings),
            "{label}: two runs give different crossings"
        );
        assert_valid(&first.layered, &first.layers, &label);
        let theirs = expected.crossings;
        let ours = first.crossings;
        assert!(
            ours <= theirs + ROUNDING * (1.0 + theirs.abs()),
            "{label}: crossings {ours}, TypeScript {theirs}"
        );
        if ours < theirs {
            fewer += 1;
        }
    }
    fewer
}

/// The banded graph's exact minimum weighted crossings, from `testing/exactCrossings.ts` on `exactGolden.test.ts`.
const BANDED_EXACT_MINIMUM: f64 = 1.0;
/// The seeds at which `thorough` must reach the exact minimum on the banded graph.
const BANDED_SEEDS: [u32; 4] = [0, 1, 7, 42];

#[test]
fn banded_graph_reaches_its_exact_minimum_at_thorough() {
    let cases = parse_cases(ORDER_FIXTURE);
    let case = cases
        .iter()
        .find(|case| case.name == "banded")
        .expect("the fixture has the banded case");
    let expected = case
        .results
        .iter()
        .find(|result| result.effort == "thorough" && !result.hinted)
        .expect("the banded case has a thorough result");
    let first = run(case, expected, case.seed);
    let exact = exact_minimum_crossings(&first.layered, &first.layers)
        .expect("the banded graph is within the exact limit");
    assert_eq!(
        bits(exact.crossings),
        bits(BANDED_EXACT_MINIMUM),
        "the exact minimum"
    );
    for seed in BANDED_SEEDS {
        let ordered = run(case, expected, seed);
        assert_valid(
            &ordered.layered,
            &ordered.layers,
            &format!("banded seed {seed}"),
        );
        assert_eq!(
            bits(ordered.crossings),
            bits(BANDED_EXACT_MINIMUM),
            "banded at thorough, seed {seed}"
        );
    }
}

#[test]
fn orders_are_valid_deterministic_and_no_worse_than_typescript_on_the_fixture_cases() {
    let cases = parse_cases(ORDER_FIXTURE);
    assert_eq!(
        cases.len(),
        ORDER_CASES,
        "every case of the fixture is checked"
    );
    let mut fewer = 0;
    let mut results = 0;
    for case in &cases {
        assert_eq!(
            case.results.len(),
            RESULTS_PER_CASE,
            "{}: every result",
            case.name
        );
        results += case.results.len();
        fewer += check_case(case);
    }
    println!("order fixtures: {results} results, {fewer} with fewer crossings than TypeScript");
}

#[test]
fn orders_are_valid_deterministic_and_no_worse_than_typescript_on_the_finance_graph() {
    let Some(path) = std::env::var_os(FINANCE_VARIABLE) else {
        return;
    };
    let text = std::fs::read_to_string(&path).expect("the finance dump is readable");
    let cases = parse_cases(&text);
    assert_eq!(cases.len(), 1, "the finance dump holds one case");
    let case = &cases[0];
    assert_eq!(
        (case.bands.len(), case.ends.len()),
        (FINANCE_NODES, FINANCE_EDGES),
        "the finance dump does not have {FINANCE_NODES} nodes and {FINANCE_EDGES} edges; update the sizes"
    );
    let fewer = check_case(case);
    println!(
        "order finance: {} results, {fewer} with fewer crossings than TypeScript",
        case.results.len()
    );
}
