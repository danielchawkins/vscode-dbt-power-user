//! Separation solver (VPSC) over plain `f64` and `u32` values: minimises the sum of `weight[i] * (x[i] - x0[i])^2`
//! subject to `x[to] - x[from] >= gap` for every separation, and returns the optimum.
//!
//! A port of `packages/graph-layout/src/solve/vpsc.ts`, `vpscBlocks.ts` and `vpscForest.ts`. Variable-block merging
//! (Dwyer, Marriott and Stuckey, GD 2005) joins the blocks across violated separations; a split step (Dwyer, Koren and
//! Marriott, IEEE TVCG 12(5), 2006) releases a tree separation whose multiplier is negative. The loop ends when every
//! separation holds and every multiplier is non-negative: the KKT conditions, so the result is the exact optimum.
//!
//! The separations must form a DAG; a self-separation with a positive gap cannot hold and is rejected. The port keeps
//! the TypeScript operation order, so it gives the same bits. Scratch buffers live in [`Projector`] and are reused
//! across calls: a re-solve of a problem no larger than one already seen allocates nothing.
//!
//! This module imports nothing from the rest of the crate (ADR 0011, rule `rust-solve-no-crate-imports`).

mod acyclic;
mod blocks;
mod forest;
mod satisfy;
#[cfg(test)]
mod tests;

use std::fmt;

use acyclic::Acyclic;
use blocks::Blocks;

/// The "none" sentinel of a `u32` index: no parent separation, no next member, no cycle end. Variables and
/// separations are numbered below it, so it never names one.
const NONE: u32 = u32::MAX;

/// The index `i` as a `u32`. Callers pass indices below the variable count, which [`Projector::solve`] keeps under
/// [`NONE`], so the conversion cannot fail; `NONE` is the fallback that would make a wrong index visible.
fn id(i: usize) -> u32 {
    u32::try_from(i).unwrap_or(NONE)
}

/// A separation `x[to] - x[from] >= gap`, with variables named by their index in `x0`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Separation {
    /// The variable on the low side.
    pub(crate) from: u32,
    /// The variable on the high side.
    pub(crate) to: u32,
    /// The minimum of `x[to] - x[from]`.
    pub(crate) gap: f64,
}

/// One projection: the targets, their weights, and the separations between them. The three slices have one entry per
/// variable (`x0` and `weight`) or per separation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Problem<'a> {
    /// The desired position of each variable.
    pub(crate) x0: &'a [f64],
    /// The weight of each variable's squared displacement; every weight must be strictly positive.
    pub(crate) weight: &'a [f64],
    /// The separations, in any order. Their order is part of the input: it fixes the cycle a rejection names.
    pub(crate) separations: &'a [Separation],
}

/// Why a problem was rejected. The messages match the TypeScript errors where the two engines reject the same input.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum SolveError {
    /// `weight` does not have one entry per variable.
    LengthMismatch {
        /// The number of variables, the length of `x0`.
        variables: usize,
        /// The length of `weight`.
        weights: usize,
    },
    /// A weight is zero, negative or NaN.
    NonPositiveWeight,
    /// A separation names a variable that is not in `x0`.
    IndexOutOfRange {
        /// The index named.
        index: u32,
        /// The number of variables.
        variables: usize,
    },
    /// A separation joins a variable to itself with a positive gap, which no position can satisfy.
    SelfSeparation {
        /// The variable.
        variable: u32,
        /// The positive gap.
        gap: f64,
    },
    /// The separations contain a directed cycle. The variables are the cycle in order, without its repeated first
    /// variable.
    Cycle {
        /// The variables of the cycle, in the direction of its separations.
        variables: Vec<u32>,
    },
    /// The operation budget was spent before the separations converged. The budget is `50 * (variables + separations)`
    /// operations, as in TypeScript.
    NotConverged,
    /// A violated separation lies inside one block with no separation to release. Not reached on a DAG; reported
    /// rather than panicking.
    Unsatisfiable {
        /// The separation that could not be satisfied.
        separation: u32,
    },
    /// The problem has more variables than a `u32` index can name.
    TooManyVariables {
        /// The number of variables.
        variables: usize,
    },
}

impl fmt::Display for SolveError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::LengthMismatch { variables, weights } => {
                write!(f, "expected {variables} weights, got {weights}")
            }
            Self::NonPositiveWeight => write!(f, "weights must be strictly positive"),
            Self::IndexOutOfRange { index, variables } => {
                write!(
                    f,
                    "variable index {index} is outside 0..{}",
                    variables.saturating_sub(1)
                )
            }
            Self::SelfSeparation { variable, gap } => {
                write!(
                    f,
                    "variable {variable} cannot be separated from itself by {gap}"
                )
            }
            Self::Cycle { variables } => match variables.split_first() {
                None => write!(f, "separations contain a directed cycle"),
                Some((first, _)) => {
                    let names: Vec<String> = variables
                        .iter()
                        .chain(std::iter::once(first))
                        .map(u32::to_string)
                        .collect();
                    write!(
                        f,
                        "separations contain a directed cycle: {}",
                        names.join(" -> ")
                    )
                }
            },
            Self::NotConverged => write!(
                f,
                "separation projection did not converge within its operation budget"
            ),
            Self::Unsatisfiable { separation } => write!(
                f,
                "separation {separation} cannot be satisfied by its block"
            ),
            Self::TooManyVariables { variables } => {
                write!(f, "{variables} variables exceed the u32 index range")
            }
        }
    }
}

impl std::error::Error for SolveError {}

/// The solver with its scratch buffers. Keep one per thread and call [`Projector::solve`] for each projection: the
/// buffers grow to the largest problem seen and are reused, so a steady re-solve allocates nothing.
#[derive(Debug, Default)]
pub(crate) struct Projector {
    blocks: Blocks,
    acyclic: Acyclic,
    out: Vec<f64>,
}

impl Projector {
    /// A projector with empty scratch buffers.
    #[must_use]
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Solves `problem` and returns the optimal position of each variable. The slice borrows the projector and is
    /// valid until the next call.
    ///
    /// A problem with no variables returns an empty slice. TypeScript throws there ("did not converge"); see the
    /// discrepancy report.
    ///
    /// # Errors
    ///
    /// Returns [`SolveError`] when the weights or separations are invalid, when the separations contain a directed
    /// cycle, or when the operation budget is spent before convergence.
    pub(crate) fn solve(&mut self, problem: &Problem<'_>) -> Result<&[f64], SolveError> {
        self.load(problem)?;
        let n = self.blocks.x0.len();
        if n == 0 {
            self.out.clear();
            return Ok(&self.out);
        }
        self.acyclic.check(n, &self.blocks.from, &self.blocks.to)?;
        self.blocks.reset();
        self.blocks.run()?;
        self.out.clear();
        self.out.extend((0..n).map(|v| self.blocks.value(v)));
        Ok(&self.out)
    }

    /// Validates `problem` and copies it into the block state. Checks run in the TypeScript order: the weights, then
    /// each separation's ends, then its self-check. Self-separations with a gap that is not positive are dropped.
    fn load(&mut self, problem: &Problem<'_>) -> Result<(), SolveError> {
        let n = problem.x0.len();
        if u32::try_from(n).map_or(true, |count| count == NONE) {
            return Err(SolveError::TooManyVariables { variables: n });
        }
        if problem.weight.len() != n {
            return Err(SolveError::LengthMismatch {
                variables: n,
                weights: problem.weight.len(),
            });
        }
        if problem.weight.iter().any(|w| w.is_nan() || *w <= 0.0) {
            return Err(SolveError::NonPositiveWeight);
        }
        let blocks = &mut self.blocks;
        blocks.x0.clear();
        blocks.x0.extend_from_slice(problem.x0);
        blocks.weight.clear();
        blocks.weight.extend_from_slice(problem.weight);
        blocks.from.clear();
        blocks.to.clear();
        blocks.gap.clear();
        for s in problem.separations {
            for index in [s.from, s.to] {
                if index as usize >= n {
                    return Err(SolveError::IndexOutOfRange {
                        index,
                        variables: n,
                    });
                }
            }
            if s.from == s.to {
                if s.gap > 0.0 {
                    return Err(SolveError::SelfSeparation {
                        variable: s.from,
                        gap: s.gap,
                    });
                }
            } else {
                blocks.from.push(s.from);
                blocks.to.push(s.to);
                blocks.gap.push(s.gap);
            }
        }
        Ok(())
    }
}

/// Solves `problem` with a fresh [`Projector`] and returns the positions. Use a [`Projector`] directly when solving
/// repeatedly, so the scratch buffers are reused.
///
/// # Errors
///
/// Returns [`SolveError`] for the same inputs as [`Projector::solve`].
pub(crate) fn solve(problem: &Problem<'_>) -> Result<Vec<f64>, SolveError> {
    Projector::new().solve(problem).map(<[f64]>::to_vec)
}
