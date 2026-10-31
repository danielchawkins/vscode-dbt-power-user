//! Seeded generator reproducing mulberry32 (`packages/graph-layout/src/random.ts`) bit for bit, and the Fisher-Yates
//! shuffle that draws from it. A seed gives the same sequence on every platform, so a layout is a pure function of its
//! graph, options and seed. The fixtures in `fixtures/parity` are printed by `scripts/parity/print-fixtures.mjs`.

/// The mulberry32 generator. Its state is one `u32`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Mulberry32 {
    state: u32,
}

/// The largest slice `shuffled` takes. Up to here the TypeScript index `floor(random() * (i + 1))` is exact in binary64,
/// so the integer form below gives the same index; past it the product can round, and the two would part.
pub(crate) const MAX_SHUFFLE_LEN: usize = 1 << 21;

impl Mulberry32 {
    /// A generator seeded with `seed`. `seededRandom` reduces its seed with `seed >>> 0`, so a seed wider than 32 bits
    /// reduces to the same `u32` on either side.
    #[must_use]
    pub(crate) const fn new(seed: u32) -> Self {
        Self { state: seed }
    }

    /// The next 32-bit output: the integer `seededRandom` divides by 2^32.
    pub(crate) const fn next_u32(&mut self) -> u32 {
        self.state = self.state.wrapping_add(0x6d2b_79f5);
        let mut t = self.state;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 0x3d));
        t ^ (t >> 14)
    }

    #[cfg(test)]
    /// The next value in `[0, 1)`: `seededRandom`'s draw, exact in binary64.
    pub(crate) fn next_f64(&mut self) -> f64 {
        f64::from(self.next_u32()) / 4_294_967_296.0
    }

    /// A copy of `items` in a Fisher-Yates order, drawing its swaps from this generator as `shuffled` does: from the
    /// last index down to 1, each swapping with `floor(random() * (i + 1))`. `items` is left alone.
    ///
    /// # Panics
    ///
    /// Panics when `items` is longer than [`MAX_SHUFFLE_LEN`], where the TypeScript index is no longer the integer one.
    #[must_use]
    pub(crate) fn shuffled<T: Clone>(&mut self, items: &[T]) -> Vec<T> {
        assert!(
            items.len() <= MAX_SHUFFLE_LEN,
            "shuffled takes at most {MAX_SHUFFLE_LEN} items, got {}",
            items.len()
        );
        let mut out = items.to_vec();
        for i in (1..out.len()).rev() {
            // floor(t / 2^32 * (i + 1)) with t the draw's integer: t * (i + 1) < 2^53 here, so the binary64 product is
            // exact and the floor is the shifted integer product.
            let bound = u64::try_from(i + 1).unwrap_or(u64::MAX);
            let index = (u64::from(self.next_u32()) * bound) >> 32;
            let j = usize::try_from(index).unwrap_or(i);
            out.swap(i, j);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The TypeScript draws of `scripts/parity/print-fixtures.mjs`, one line per seed: `random <seed> <draw>...`.
    const RANDOM: &str = include_str!("../../fixtures/parity/random.txt");

    fn lines_starting(prefix: &str) -> impl Iterator<Item = Vec<&'static str>> {
        RANDOM
            .lines()
            .filter(move |line| line.split(' ').next() == Some(prefix))
            .map(|line| line.split(' ').collect())
    }

    #[test]
    fn draws_match_the_typescript_fixture_exactly() {
        let mut checked = 0;
        for fields in lines_starting("random") {
            let seed: u32 = fields[1].parse().expect("fixture seed is a u32");
            let mut generator = Mulberry32::new(seed);
            for expected in &fields[2..] {
                let expected: f64 = expected.parse().expect("fixture draw is a decimal");
                assert_eq!(generator.next_f64(), expected, "seed {seed}");
                checked += 1;
            }
        }
        assert_eq!(
            checked,
            7 * 16,
            "every seed and draw of the fixture is checked"
        );
    }

    #[test]
    fn shuffles_match_the_typescript_fixture_exactly() {
        let mut checked = 0;
        for fields in lines_starting("shuffle") {
            let seed: u32 = fields[1].parse().expect("fixture seed is a u32");
            let length: usize = fields[2].parse().expect("fixture length is a usize");
            let items: Vec<usize> = (0..length).collect();
            let expected: Vec<usize> = match fields[3] {
                "-" => Vec::new(),
                list => list
                    .split(',')
                    .map(|index| index.parse().expect("fixture index is a usize"))
                    .collect(),
            };
            assert_eq!(
                Mulberry32::new(seed).shuffled(&items),
                expected,
                "seed {seed}, length {length}"
            );
            checked += 1;
        }
        assert_eq!(
            checked,
            7 * 5,
            "every seed and length of the fixture is checked"
        );
    }

    #[test]
    fn seed_zero_first_draw_is_the_typescript_value() {
        // seededRandom(0)() is 0.26642920868471265 in the TypeScript: the first draw of the first fixture line.
        assert_eq!(Mulberry32::new(0).next_f64(), 0.266_429_208_684_712_65);
    }

    #[test]
    fn same_seed_same_sequence_and_draws_in_unit_interval() {
        for seed in [0, 1, 42, u32::MAX] {
            let mut a = Mulberry32::new(seed);
            let mut b = Mulberry32::new(seed);
            for _ in 0..200 {
                let x = a.next_f64();
                assert_eq!(x, b.next_f64());
                assert!((0.0..1.0).contains(&x));
            }
        }
    }

    #[test]
    fn shuffled_is_a_permutation_and_leaves_its_input_alone() {
        let items: Vec<u32> = (0..50).collect();
        let copy = items.clone();
        let mut out = Mulberry32::new(9).shuffled(&items);
        assert_eq!(items, copy);
        out.sort_unstable();
        assert_eq!(out, copy);
    }

    #[test]
    fn shuffling_the_longest_allowed_slice_is_accepted() {
        let items = vec![0_u8; MAX_SHUFFLE_LEN];
        assert_eq!(Mulberry32::new(1).shuffled(&items).len(), MAX_SHUFFLE_LEN);
    }
}
