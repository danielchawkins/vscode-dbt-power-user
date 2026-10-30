//! Checks of the solver against the oracle, the MSAGL cases and TypeScript's output. They live outside `solve/` because
//! `solve` imports nothing from the crate (ADR 0011): the oracles and fixtures come from `testkit::solve`.
//!
//! The tolerances are those of the TypeScript tests: `vpscCases.test.ts` (positions within 1e-4 of MSAGL, goal close to
//! six digits), `vpsc.test.ts` (feasibility 1e-7, solver slack 1e-9, objective within 1e-12 relative).
//!
//! The property checks are proptest properties over the testkit generators, which draw from mulberry32.

use crate::solve::{Problem, Projector, Separation, solve};
use crate::testkit::solve::{
    Instance, cases, chain, exact_optimum, objective, random_outputs, random_problem, small_dag,
};
use proptest::prelude::*;

/// MSAGL prints expected positions to five significant digits, so the comparison is looser than the solver's own.
const POSITION_TOLERANCE: f64 = 1e-4;
/// `toBeCloseTo(goal, 6)`: the difference is below half of 10^-6.
const GOAL_TOLERANCE: f64 = 5e-7;
/// Feasibility of a returned position.
const TOLERANCE: f64 = 1e-7;
/// `VIOLATION_TOLERANCE` of the solver: a separation counts as held once its slack is above minus this.
const SOLVER_SLACK: f64 = 1e-9;
/// Relative rounding allowed between two computations of the same optimum.
const ROUNDING: f64 = 1e-12;
/// Seeds per property check.
const PROPERTY_CASES: u32 = 300;

fn feasible(seps: &[Separation], x: &[f64], tolerance: f64) -> bool {
    seps.iter()
        .all(|s| x[s.to as usize] - x[s.from as usize] >= s.gap - tolerance)
}

/// The MSAGL goal: the weighted squared distance moved from the desired positions.
fn goal_of(desired: &[f64], weight: Option<&[f64]>, x: &[f64]) -> f64 {
    desired.iter().enumerate().fold(0.0, |sum, (i, &d)| {
        let w = weight.map_or(1.0, |w| w[i]);
        let delta = x[i] - d;
        sum + w * (delta * delta)
    })
}

/// Checks that `x` is the optimum within the solver's slack: feasible within the slack, no costlier than the exact
/// optimum, and no cheaper than the exact optimum of the problem with every gap relaxed by that slack.
fn expect_optimal(
    x0: &[f64],
    weight: &[f64],
    seps: &[Separation],
    x: &[f64],
) -> Result<(), String> {
    if !feasible(seps, x, SOLVER_SLACK) {
        return Err(format!("not feasible within the solver slack: {x:?}"));
    }
    let cost = objective(x0, weight, x);
    let exact = exact_optimum(x0, weight, seps);
    let relaxed_seps: Vec<Separation> = seps
        .iter()
        .map(|s| Separation {
            gap: s.gap - SOLVER_SLACK,
            ..*s
        })
        .collect();
    let relaxed = exact_optimum(x0, weight, &relaxed_seps);
    if cost > exact + ROUNDING * (1.0 + exact) {
        return Err(format!("cost {cost} above the exact optimum {exact}"));
    }
    if cost < relaxed - ROUNDING * (1.0 + relaxed) {
        return Err(format!("cost {cost} below the relaxed optimum {relaxed}"));
    }
    Ok(())
}

fn sep(from: u32, to: u32, gap: f64) -> Separation {
    Separation { from, to, gap }
}

/// Whether two outputs are the same bits: the same length, and every value equal by `to_bits`, so -0 and +0 differ.
fn same_bits(a: &[f64], b: &[f64]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.to_bits() == y.to_bits())
}

#[test]
fn msagl_cases_hold_their_expected_positions_and_goals() {
    let mut bit_identical = 0;
    let all = cases();
    for case in &all {
        let weight = case
            .weight
            .clone()
            .unwrap_or_else(|| vec![1.0; case.desired.len()]);
        let x = solve(&Problem {
            x0: &case.desired,
            weight: &weight,
            separations: &case.seps,
        })
        .unwrap_or_else(|e| panic!("{}: {e}", case.name));
        for (i, &value) in case.expected.iter().enumerate() {
            let got = x.get(i).copied().unwrap_or(f64::NAN);
            assert!(
                (got - value).abs() <= POSITION_TOLERANCE,
                "{}: x[{i}] = {got}, MSAGL {value}",
                case.name
            );
        }
        if let Some(goal) = case.goal {
            let got = goal_of(&case.desired, case.weight.as_deref(), &x);
            assert!(
                (got - goal).abs() < GOAL_TOLERANCE,
                "{}: goal {got}, MSAGL {goal}",
                case.name
            );
        }
        if same_bits(&x, &case.ts) {
            bit_identical += 1;
        }
    }
    println!(
        "msagl cases: {} of {} bit-identical to TypeScript",
        bit_identical,
        all.len()
    );
}

#[test]
fn msagl_rejections_name_their_cycles() {
    let direct = [sep(0, 1, 2.0), sep(1, 0, 3.0)];
    let message = solve(&Problem {
        x0: &[1.0, 2.0],
        weight: &[1.0, 1.0],
        separations: &direct,
    })
    .expect_err("directed cycle")
    .to_string();
    assert!(
        message.contains("directed cycle: 0 -> 1 -> 0")
            || message.contains("directed cycle: 1 -> 0 -> 1"),
        "{message}"
    );
}

/// Each random problem solved by one reused projector: every separation holds, the objective equals TypeScript's
/// within the oracle tolerance, and the outputs that are not bit-identical are counted.
#[test]
fn random_problems_match_typescript() {
    let mut projector = Projector::new();
    let outputs = random_outputs();
    let mut bit_identical = 0;
    let mut differences = Vec::new();
    for seed in 0..crate::testkit::solve::RANDOM_PROBLEMS {
        let Instance { x0, weight, seps } = random_problem(seed);
        let ts = &outputs[seed as usize];
        let x = projector
            .solve(&Problem {
                x0: &x0,
                weight: &weight,
                separations: &seps,
            })
            .unwrap_or_else(|e| panic!("seed {seed}: {e}"))
            .to_vec();
        assert!(
            feasible(&seps, &x, TOLERANCE),
            "seed {seed}: a separation does not hold"
        );
        let rust_cost = objective(&x0, &weight, &x);
        let ts_cost = objective(&x0, &weight, ts);
        assert!(
            (rust_cost - ts_cost).abs() <= ROUNDING * (1.0 + ts_cost),
            "seed {seed}: objective {rust_cost}, TypeScript {ts_cost}"
        );
        if same_bits(&x, ts) {
            bit_identical += 1;
        } else {
            differences.push(seed);
        }
    }
    println!(
        "random problems: {} of {} bit-identical to TypeScript; {} differ in the last bit or more: {:?}",
        bit_identical,
        crate::testkit::solve::RANDOM_PROBLEMS,
        differences.len(),
        differences
    );
}

/// Writes the output of every random problem as the hex of its bits, one `seed<TAB>bits` line per seed, to the file named
/// by `GRAPH_LAYOUT_SOLVE_OUT`. `just crates::parity` runs this natively and under WASI and compares the two files byte
/// for byte. Without the variable it does nothing, so the ordinary test run writes nothing.
#[test]
fn random_outputs_are_written_for_the_parity_comparison() {
    use std::fmt::Write as _;

    let Some(path) = std::env::var_os("GRAPH_LAYOUT_SOLVE_OUT") else {
        return;
    };
    let mut projector = Projector::new();
    let mut text = String::new();
    for seed in 0..crate::testkit::solve::RANDOM_PROBLEMS {
        let Instance { x0, weight, seps } = random_problem(seed);
        let x = projector
            .solve(&Problem {
                x0: &x0,
                weight: &weight,
                separations: &seps,
            })
            .unwrap_or_else(|e| panic!("seed {seed}: {e}"));
        let bits: Vec<String> = x.iter().map(|v| format!("{:016x}", v.to_bits())).collect();
        writeln!(text, "{seed}\t{}", bits.join(",")).expect("writing to a String cannot fail");
    }
    std::fs::write(path, text).expect("the parity output file is writable");
}

/// Two blocks whose merge closes a cycle of blocks: a<b and c<d merge first, then a<d and c<b cross the two blocks.
#[test]
fn crossing_blocks_are_solved_to_the_exact_optimum() {
    let x0 = [0.0; 4];
    let weight = [1.0; 4];
    let seps = [
        sep(0, 1, 1.0),
        sep(2, 3, 1.0),
        sep(0, 3, 0.5),
        sep(2, 1, 0.5),
    ];
    let x = solve(&Problem {
        x0: &x0,
        weight: &weight,
        separations: &seps,
    })
    .expect("feasible");
    expect_optimal(&x0, &weight, &seps, &x).expect("optimal");
}

/// Gaps of 1e-8 and -4e-6 beside zero gaps, so blocks merge and split at the edge of the solver's tolerance.
#[test]
fn near_degenerate_gaps_are_solved_to_the_exact_optimum() {
    let instances = [
        (
            vec![0.013_873_527_966_563_645, 0.0, 0.0],
            vec![1.904_696_304_361_651, 0.1, 2.139_239_707_294_434_5],
            vec![
                sep(0, 1, 0.0),
                sep(0, 2, -0.000_003_657_608_469_727_521),
                sep(1, 2, 0.0),
            ],
        ),
        (
            vec![0.0, 0.0, 0.0, 0.0, -1.347_071_049_676_007],
            vec![
                1.862_973_362_045_653_4,
                1.250_934_181_462_657_6,
                0.100_000_000_000_000_09,
                0.1,
                2.944_343_669_229_674_7,
            ],
            vec![
                sep(1, 4, 0.0),
                sep(0, 4, 0.0),
                sep(1, 3, 2.493_734_257_980_051_8e-8),
                sep(0, 3, 0.0),
                sep(0, 1, 0.0),
                sep(0, 3, 0.0),
                sep(3, 4, 0.0),
            ],
        ),
    ];
    for (x0, weight, seps) in &instances {
        let x = solve(&Problem {
            x0,
            weight,
            separations: seps,
        })
        .expect("feasible");
        expect_optimal(x0, weight, seps, &x).expect("optimal");
    }
}

// The property checks draw a mulberry32 seed from proptest, so a failing seed shrinks toward 0 and is persisted to
// `proptest-regressions/`. The generators are the testkit's, which the TypeScript fixtures also use.
proptest! {
    #![proptest_config(ProptestConfig::with_cases(PROPERTY_CASES))]

    /// Small DAGs (`testkit::solve::small_dag`) reach the exact optimum and hold every separation.
    #[test]
    fn small_dags_reach_the_exact_optimum(seed in any::<u32>()) {
        let Instance { x0, weight, seps } = small_dag(seed);
        let x = solve(&Problem {
            x0: &x0,
            weight: &weight,
            separations: &seps,
        })
        .map_err(|e| TestCaseError::fail(format!("seed {seed}: {e}")))?;
        prop_assert!(
            feasible(&seps, &x, TOLERANCE),
            "a separation does not hold: {x:?}"
        );
        expect_optimal(&x0, &weight, &seps, &x)
            .map_err(|e| TestCaseError::fail(format!("seed {seed}: {e}")))?;
    }

    /// Chains (`testkit::solve::chain`), the one-layer projection of `projectRanks`, reach the exact optimum.
    #[test]
    fn chains_reach_the_exact_optimum(seed in any::<u32>()) {
        let Instance { x0, weight, seps } = chain(seed);
        let x = solve(&Problem {
            x0: &x0,
            weight: &weight,
            separations: &seps,
        })
        .map_err(|e| TestCaseError::fail(format!("seed {seed}: {e}")))?;
        prop_assert!(
            feasible(&seps, &x, TOLERANCE),
            "a separation does not hold: {x:?}"
        );
        expect_optimal(&x0, &weight, &seps, &x)
            .map_err(|e| TestCaseError::fail(format!("seed {seed}: {e}")))?;
    }
}
