//! The Fenwick tree against a plain array and against TypeScript. Integer weights sum exactly in binary64, so every prefix
//! must equal the naive sum, and the tree must not change any entry it was not asked to add to. Fractional weights are
//! checked bit for bit against `fixtures/parity/fenwick.txt`, which `fenwick.ts` wrote from the same draws in the same
//! order, so a change in the order of the summation is caught.

use super::Fenwick;
use crate::rand::Mulberry32;

/// The TypeScript prefix sums of `scripts/parity/print-fixtures.mjs fenwick`, one line per seed and size.
const FENWICK: &str = include_str!("../../fixtures/parity/fenwick.txt");

#[test]
fn an_empty_tree_sums_to_zero() {
    let tree = Fenwick::new(0);
    assert_eq!(tree.prefix(0), 0.0);
    let tree = Fenwick::new(5);
    for end in 0..=5 {
        assert_eq!(tree.prefix(end), 0.0);
    }
}

#[test]
fn prefixes_match_a_plain_array_under_random_integer_updates() {
    let mut random = Mulberry32::new(7);
    for size in [1_usize, 2, 3, 8, 13, 64, 200] {
        let mut tree = Fenwick::new(size);
        let mut plain = vec![0.0; size];
        for _ in 0..(4 * size + 10) {
            let index = usize::try_from(random.next_u32()).unwrap_or(0) % size;
            let delta = f64::from(random.next_u32() % 9);
            tree.add(index, delta);
            plain[index] += delta;
            for end in 0..=size {
                let naive: f64 = plain[..end].iter().sum();
                assert_eq!(tree.prefix(end), naive, "size {size}, prefix {end}");
            }
        }
    }
}

#[test]
fn fractional_prefixes_match_the_typescript_fixture_bit_for_bit() {
    let mut checked = 0;
    let mut cases = 0;
    for line in FENWICK.lines().filter(|line| line.starts_with("fenwick ")) {
        let fields: Vec<&str> = line.split(' ').collect();
        let seed: u32 = fields[1].parse().expect("fixture seed is a u32");
        let size: usize = fields[2].parse().expect("fixture size is an integer");
        // The same draws as `print-fixtures.mjs`: an index from the u32, then a delta in [-1, 3).
        let mut random = Mulberry32::new(seed);
        let mut tree = Fenwick::new(size);
        for _ in 0..(4 * size + 10) {
            let index = usize::try_from(random.next_u32()).unwrap_or(0) % size;
            tree.add(index, random.next_f64() * 4.0 - 1.0);
        }
        let expected: Vec<&str> = fields[3].split(',').collect();
        assert_eq!(expected.len(), size + 1, "seed {seed}, size {size}");
        for (end, bits) in expected.iter().enumerate() {
            let actual = format!("{:016x}", tree.prefix(end).to_bits());
            assert_eq!(actual, *bits, "seed {seed}, size {size}, prefix {end}");
            checked += 1;
        }
        cases += 1;
    }
    assert_eq!(
        cases,
        3 * 7,
        "every seed and size of the fixture is checked"
    );
    assert_eq!(checked, 3 * (2 + 3 + 4 + 9 + 14 + 65 + 201), "every prefix");
}

#[test]
fn an_update_reaches_only_the_prefixes_after_it() {
    let mut tree = Fenwick::new(10);
    tree.add(4, 2.5);
    for end in 0..=4 {
        assert_eq!(tree.prefix(end), 0.0, "prefix {end} is before the update");
    }
    for end in 5..=10 {
        assert_eq!(tree.prefix(end), 2.5, "prefix {end} is after the update");
    }
}
