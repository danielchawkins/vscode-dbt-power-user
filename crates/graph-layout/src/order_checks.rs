//! Crossings and orders against TypeScript. The crossings: `total_crossings` and `exact_minimum_crossings` on the seeded
//! random layered graphs of `fixtures/parity/crossings.txt`, which `print-fixtures.mjs crossings` wrote from
//! `totalCrossings` and `exactMinimumCrossings` on the same graphs. The orders: `order` on the same random graphs
//! (`fixtures/parity/order.txt`, with hints on odd seeds) and on the finance lineage graph
//! (`fixtures/parity/order-finance.txt`, the layered graph `layer` builds, at each effort). The Rust side replays the
//! draws of `randomCrossingCase` and `randomHints`, so a difference in either side shows as a bit or order difference.

use crate::budget::Budget;
use crate::layering::{LayeredGraph, LayeredNode, Segment};
use crate::order::{Hints, OrderModel, exact_minimum_crossings, order, total_crossings};
use crate::rand::Mulberry32;

const FIXTURE: &str = include_str!("../fixtures/parity/crossings.txt");
const ORDER_FIXTURE: &str = include_str!("../fixtures/parity/order.txt");
const FINANCE_FIXTURE: &str = include_str!("../fixtures/parity/order-finance.txt");

/// The number of seeded random cases of `order.txt`.
const ORDER_CASES: usize = 120;
/// The efforts of `order.txt` and `order-finance.txt`, and the number of finance cases (one per effort).
const FINANCE_CASES: usize = 3;

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

#[test]
fn orders_match_typescript_bit_for_bit_on_random_graphs() {
    let mut checked = 0;
    for line in ORDER_FIXTURE
        .lines()
        .filter(|line| line.starts_with("case "))
    {
        let fields: Vec<&str> = line.split(' ').collect();
        let seed: u32 = fields[1].parse().expect("fixture seed is a u32");
        let effort = fields[2];
        let hinted = fields[3] == "1";
        let (graph, _) = random_case(seed);
        let hints = hinted.then(|| random_hints(seed, graph.nodes.len()));
        let budget = Budget::for_effort(Some(effort)).expect("a known effort");
        let result = order(&graph, hints.as_ref(), &budget, seed);
        let label = format!("seed {seed} {effort} hinted {hinted}");
        assert_eq!(render(&result.layers), fields[4], "{label}: the order");
        assert_eq!(bits(result.crossings), fields[5], "{label}: crossings");
        checked += 1;
    }
    assert_eq!(checked, ORDER_CASES, "every case of the fixture is checked");
}

/// The finance lineage graph at one effort: the layered graph `layer` built, and the order TypeScript gave it.
struct FinanceCase {
    effort: String,
    graph: LayeredGraph,
    layers: String,
    crossings: String,
}

/// A floating-point value as the IEEE bits `bitsHex` prints.
fn float(hex: &str) -> f64 {
    f64::from_bits(u64::from_str_radix(hex, 16).expect("hex bits"))
}

/// A comma-separated list of indices, as `csv` prints it.
fn indices(text: &str) -> Vec<usize> {
    text.split(',')
        .map(|x| x.parse().expect("an index"))
        .collect()
}

/// The finance cases of `order-finance.txt`: each `effort` section gives the layered graph line by line, then the order.
fn finance_cases() -> Vec<FinanceCase> {
    let mut cases = Vec::new();
    let mut effort = String::new();
    let mut ranks = 0;
    let mut nodes = Vec::new();
    let mut segments = Vec::new();
    let mut block = Vec::new();
    let mut paths = Vec::new();
    for line in FINANCE_FIXTURE
        .lines()
        .filter(|line| !line.starts_with('#'))
    {
        let fields: Vec<&str> = line.split(' ').collect();
        match fields[0] {
            "effort" => {
                effort = fields[1].to_owned();
                nodes.clear();
                segments.clear();
                paths.clear();
            }
            "ranks" => ranks = fields[1].parse().expect("a rank count"),
            "node" => nodes.push(LayeredNode {
                id: match fields[3] {
                    "-" => None,
                    id => Some(id.parse().expect("a scope index")),
                },
                rank: fields[1].parse().expect("a rank"),
                breadth: float(fields[2]),
                port: None,
            }),
            "segment" => segments.push(Segment {
                top: fields[1].parse().expect("a node index"),
                bottom: fields[2].parse().expect("a node index"),
                weight: float(fields[3]),
                top_offset: float(fields[4]),
                bottom_offset: float(fields[5]),
            }),
            "block" => block = indices(fields[1]),
            "paths" => {
                paths = fields[1..]
                    .iter()
                    .map(|&path| {
                        if path == "-" {
                            Vec::new()
                        } else {
                            indices(path)
                        }
                    })
                    .collect();
            }
            "order" => cases.push(FinanceCase {
                effort: effort.clone(),
                graph: LayeredGraph {
                    nodes: nodes.clone(),
                    segments: segments.clone(),
                    block: block.clone(),
                    paths: paths.clone(),
                    ranks,
                },
                layers: fields[1].to_owned(),
                crossings: fields[2].to_owned(),
            }),
            other => panic!("unknown line in order-finance.txt: {other}"),
        }
    }
    cases
}

#[test]
fn order_matches_typescript_on_the_finance_graph() {
    let cases = finance_cases();
    assert_eq!(cases.len(), FINANCE_CASES, "one order per effort");
    for case in &cases {
        let budget = Budget::for_effort(Some(&case.effort)).expect("a known effort");
        let result = order(&case.graph, None, &budget, 0);
        let label = format!("finance {}", case.effort);
        assert_eq!(render(&result.layers), case.layers, "{label}: the order");
        assert_eq!(bits(result.crossings), case.crossings, "{label}: crossings");
    }
}
