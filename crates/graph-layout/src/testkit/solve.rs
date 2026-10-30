//! Oracles and fixtures for the solver's tests: the exact optimum by active-set enumeration (`testing/exactSeparations.ts`),
//! the MSAGL cases (`fixtures/parity/solve-cases.txt`), the 2,000 random problems (`fixtures/parity/solve-random.txt`)
//! and the generators behind the property checks. `solve` itself imports nothing from the crate (ADR 0011), so its tests
//! reach these through `solve_checks`.

use crate::solve::Separation;

/// The MSAGL and chain cases, printed by `scripts/parity/print-fixtures.mjs solve-cases`.
const CASES: &str = include_str!("../../fixtures/parity/solve-cases.txt");
/// The random problems' solutions, printed by `scripts/parity/print-fixtures.mjs solve-random`.
const RANDOM: &str = include_str!("../../fixtures/parity/solve-random.txt");

/// One MSAGL case: the solver's input, the MSAGL expected positions, and the TypeScript output.
pub(crate) struct Case {
    pub(crate) name: String,
    pub(crate) desired: Vec<f64>,
    pub(crate) weight: Option<Vec<f64>>,
    pub(crate) seps: Vec<Separation>,
    pub(crate) expected: Vec<f64>,
    pub(crate) goal: Option<f64>,
    pub(crate) ts: Vec<f64>,
}

/// A problem of the random set: targets, weights and separations.
pub(crate) struct Instance {
    pub(crate) x0: Vec<f64>,
    pub(crate) weight: Vec<f64>,
    pub(crate) seps: Vec<Separation>,
}

fn list(field: &str) -> Vec<f64> {
    if field == "-" {
        return Vec::new();
    }
    field
        .split(',')
        .map(|v| v.parse().expect("a number in the fixture"))
        .collect()
}

fn seps(field: &str) -> Vec<Separation> {
    if field == "-" {
        return Vec::new();
    }
    field
        .split(';')
        .map(|s| {
            let mut parts = s.split(':');
            let mut next = || parts.next().expect("from:to:gap");
            Separation {
                from: next().parse().expect("from"),
                to: next().parse().expect("to"),
                gap: next().parse().expect("gap"),
            }
        })
        .collect()
}

/// The data lines of a fixture, `#` comments skipped, with their fields split on tabs, keeping those whose first field
/// is `kind`.
fn records(source: &'static str, kind: &str) -> Vec<Vec<&'static str>> {
    source
        .lines()
        .filter(|line| !line.starts_with('#'))
        .map(|line| line.split('\t').collect::<Vec<_>>())
        .filter(|fields| fields[0] == kind)
        .collect()
}

/// The MSAGL and chain cases, in the order `vpscCases.test.ts` runs them.
pub(crate) fn cases() -> Vec<Case> {
    records(CASES, "case")
        .into_iter()
        .map(|f| Case {
            name: f[1].to_owned(),
            desired: list(f[2]),
            weight: (f[3] != "-").then(|| list(f[3])),
            seps: seps(f[4]),
            expected: list(f[5]),
            goal: (f[6] != "-").then(|| f[6].parse().expect("goal")),
            ts: list(f[7]),
        })
        .collect()
}

/// The TypeScript solutions of the random problems, indexed by seed.
pub(crate) fn random_outputs() -> Vec<Vec<f64>> {
    let lines = records(RANDOM, "problem");
    assert_eq!(lines.len(), RANDOM_PROBLEMS as usize, "one line per seed");
    lines
        .iter()
        .enumerate()
        .map(|(seed, f)| {
            assert_eq!(f[1], seed.to_string(), "the seeds are in order");
            list(f[2])
        })
        .collect()
}

/// The number of random problems in the fixture.
pub(crate) const RANDOM_PROBLEMS: u32 = 2000;

/// mulberry32, as `seededRandom` in `random.ts`. Draws are kept as their 32-bit integer, so `floor(draw * k)` is the
/// integer `(t * k) >> 32` exactly, and no float-to-integer cast is needed.
struct Mulberry(u32);

impl Mulberry {
    fn next_u32(&mut self) -> u32 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 0x3d));
        t ^ (t >> 14)
    }

    /// A draw in [0, 1), as `random()` in TypeScript.
    fn unit(&mut self) -> f64 {
        f64::from(self.next_u32()) / 4_294_967_296.0
    }

    /// `Math.floor(random() * k)`, exact in integers.
    fn below(&mut self, k: u32) -> u32 {
        u32::try_from((u64::from(self.next_u32()) * u64::from(k)) >> 32).unwrap_or(0)
    }
}

/// Random problem `seed`, drawn in the order of `randomProblem` in `scripts/parity/print-fixtures.mjs`. Every fourth
/// seed is on integer targets and gaps, so ties and degenerate blocks come up.
pub(crate) fn random_problem(seed: u32) -> Instance {
    let mut draws = Mulberry(seed);
    let n = 2 + draws.below(24) as usize;
    let size = u32::try_from(n).expect("at most 25 variables");
    let integral = seed.is_multiple_of(4);
    let x0 = (0..n)
        .map(|_| {
            if integral {
                f64::from(draws.below(10))
            } else {
                draws.unit() * 100.0 - 50.0
            }
        })
        .collect();
    let weight = (0..n).map(|_| 0.5 + draws.unit() * 2.0).collect();
    let count = draws.below(3 * size);
    let mut separations = Vec::new();
    for _ in 0..count {
        let mut a = draws.below(size);
        let mut b = draws.below(size);
        if a == b {
            continue;
        }
        if a > b {
            (a, b) = (b, a);
        }
        let gap = if integral {
            f64::from(draws.below(5)) - 2.0
        } else {
            draws.unit() * 10.0 - 2.0
        };
        separations.push(Separation {
            from: a,
            to: b,
            gap,
        });
    }
    Instance {
        x0,
        weight,
        seps: separations,
    }
}

/// A small random DAG for the exact-oracle property checks: up to 8 variables and 12 separations, every separation
/// pointing from a lower index to a higher, so no cycle can close. Gaps may be negative.
pub(crate) fn small_dag(seed: u32) -> Instance {
    let mut draws = Mulberry(seed);
    let n = 2 + draws.below(7) as usize;
    let size = u32::try_from(n).expect("at most 8 variables");
    let x0 = (0..n).map(|_| draws.unit() * 40.0 - 20.0).collect();
    let weight = (0..n).map(|_| 0.1 + draws.unit() * 4.9).collect();
    let count = draws.below(13);
    let mut separations = Vec::new();
    for _ in 0..count {
        let a = draws.below(size);
        let b = draws.below(size);
        if a == b {
            continue;
        }
        let gap = draws.unit() * 10.0 - 5.0;
        separations.push(Separation {
            from: a.min(b),
            to: a.max(b),
            gap,
        });
    }
    Instance {
        x0,
        weight,
        seps: separations,
    }
}

/// A random chain of up to 10 variables with a gap between neighbours: the one-layer projection `projectRanks` solves.
pub(crate) fn chain(seed: u32) -> Instance {
    let mut draws = Mulberry(seed);
    let n = 1 + draws.below(10) as usize;
    let x0 = (0..n).map(|_| draws.unit() * 40.0 - 20.0).collect();
    let weight = (0..n).map(|_| 0.1 + draws.unit() * 4.9).collect();
    let seps = (1..n)
        .map(|k| Separation {
            from: u32::try_from(k - 1).expect("a small index"),
            to: u32::try_from(k).expect("a small index"),
            gap: draws.unit() * 5.0,
        })
        .collect();
    Instance { x0, weight, seps }
}

/// The optimal cost of an instance, by exact enumeration.
/// Port of `exactSeparationOptimum` in `testing/exactSeparations.ts`.
pub(crate) fn exact_optimum(x0: &[f64], weight: &[f64], seps: &[Separation]) -> f64 {
    let mut best: Option<f64> = None;
    for mask in 0u64..(1u64 << seps.len()) {
        let active: Vec<Separation> = seps
            .iter()
            .enumerate()
            .filter(|(c, _)| (mask >> c) & 1 == 1)
            .map(|(_, s)| *s)
            .collect();
        let Some((x, multipliers)) = kkt_point(x0, weight, &active) else {
            continue;
        };
        if multipliers.iter().any(|&m| m < -1e-12) {
            continue;
        }
        if !seps
            .iter()
            .all(|s| x[s.to as usize] - x[s.from as usize] >= s.gap - 1e-12)
        {
            continue;
        }
        let cost = objective(x0, weight, &x);
        if best.is_none_or(|b| cost < b) {
            best = Some(cost);
        }
    }
    best.expect("no feasible active set: the separations contain a cycle")
}

/// The KKT point with `active` held as equalities, with its multipliers, or `None` when their rows are dependent.
fn kkt_point(x0: &[f64], weight: &[f64], active: &[Separation]) -> Option<(Vec<f64>, Vec<f64>)> {
    let n = x0.len();
    let size = n + active.len();
    // [2W  -A^T] [x ]   [2W x0]
    // [A    0  ] [mu] = [gap  ], with mu >= 0 for x_to - x_from >= gap.
    let mut rows = vec![vec![0.0; size + 1]; size];
    for i in 0..n {
        rows[i][i] = 2.0 * weight[i];
        rows[i][size] = 2.0 * weight[i] * x0[i];
    }
    for (r, s) in active.iter().enumerate() {
        let (from, to) = (s.from as usize, s.to as usize);
        rows[n + r][to] = 1.0;
        rows[n + r][from] = -1.0;
        rows[n + r][size] = s.gap;
        rows[to][n + r] = -1.0;
        rows[from][n + r] = 1.0;
    }
    let solution = gauss_jordan(rows, size)?;
    Some((solution[..n].to_vec(), solution[n..].to_vec()))
}

/// Solves the augmented `size` x `size` system by Gauss-Jordan elimination with partial pivoting.
fn gauss_jordan(mut rows: Vec<Vec<f64>>, size: usize) -> Option<Vec<f64>> {
    for col in 0..size {
        let mut pivot = col;
        for r in col + 1..size {
            if rows[r][col].abs() > rows[pivot][col].abs() {
                pivot = r;
            }
        }
        if rows[pivot][col].abs() < 1e-12 {
            return None;
        }
        rows.swap(col, pivot);
        let lead = rows[col].clone();
        for (r, row) in rows.iter_mut().enumerate() {
            if r == col {
                continue;
            }
            let factor = row[col] / lead[col];
            if factor == 0.0 {
                continue;
            }
            for c in col..=size {
                row[c] -= factor * lead[c];
            }
        }
    }
    Some(
        rows.iter()
            .enumerate()
            .map(|(i, row)| row[size] / row[i])
            .collect(),
    )
}

/// The weighted squared distance of `x` from the targets.
pub(crate) fn objective(x0: &[f64], weight: &[f64], x: &[f64]) -> f64 {
    x0.iter().enumerate().fold(0.0, |sum, (i, &v)| {
        let d = x[i] - v;
        sum + weight[i] * (d * d)
    })
}
