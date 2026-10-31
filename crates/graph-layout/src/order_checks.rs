//! Crossings against TypeScript: `total_crossings` and `exact_minimum_crossings` on the seeded random layered graphs of
//! `fixtures/parity/crossings.txt`, which `print-fixtures.mjs crossings` wrote from `totalCrossings` and
//! `exactMinimumCrossings` on the same graphs. The Rust side replays the draws of `randomCrossingCase`, so a difference
//! in either side's crossing count, in the Fenwick sums or in the exact search shows as a bit difference.

use crate::layering::{LayeredGraph, LayeredNode, Segment};
use crate::order::{OrderModel, exact_minimum_crossings, total_crossings};
use crate::rand::Mulberry32;

const FIXTURE: &str = include_str!("../fixtures/parity/crossings.txt");

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
            id: None,
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
