//! The solver loop (`vpsc.ts`): merge blocks across violated separations, release a violation inside a block, split off
//! negative multipliers, and stop at the KKT point. A step budget guards convergence, as in TypeScript.

use std::mem::take;

use super::SolveError;
use super::blocks::Blocks;
use super::id;

/// A separation whose slack is below minus this is violated and must be merged.
const VIOLATION_TOLERANCE: f64 = 1e-9;
/// An active separation whose multiplier is below minus this is split off.
const MULTIPLIER_TOLERANCE: f64 = 1e-9;
/// Operations allowed per variable and separation before the solver gives up on convergence.
const STEP_FACTOR: i64 = 50;

/// The operations left before the solver gives up.
#[derive(Debug)]
pub(super) struct Budget {
    steps: i64,
}

impl Budget {
    /// Counts one solver operation, failing when the budget is spent.
    fn spend(&mut self) -> Result<(), SolveError> {
        self.steps -= 1;
        if self.steps < 0 {
            Err(SolveError::NotConverged)
        } else {
            Ok(())
        }
    }
}

impl Blocks {
    /// Runs the solver to the KKT point: satisfy the separations, split the negative multipliers, and repeat until none
    /// is negative.
    pub(super) fn run(&mut self) -> Result<(), SolveError> {
        let variables = self.x0.len() + self.gap.len();
        let mut budget = Budget {
            steps: STEP_FACTOR * i64::try_from(variables).unwrap_or(i64::MAX),
        };
        loop {
            self.satisfy(&mut budget)?;
            if !self.split_negative(&mut budget)? {
                return Ok(());
            }
        }
    }

    /// Merges blocks across violated separations until none is violated, releasing a violation inside a block first.
    /// After each change, negative multipliers are split off at once, so the multipliers stay non-negative between
    /// steps.
    fn satisfy(&mut self, budget: &mut Budget) -> Result<(), SolveError> {
        loop {
            budget.spend()?;
            if let Some(across) = self.most_violated(false, VIOLATION_TOLERANCE) {
                let ends = [self.from[across as usize], self.to[across as usize]];
                self.join(across);
                self.split_negative_in(ends, budget)?;
            } else {
                let Some(within) = self.most_violated(true, VIOLATION_TOLERANCE) else {
                    return Ok(());
                };
                self.resolve_within(within)?;
                while self.split_negative(budget)? {
                    // Each split leaves the multipliers of the remaining separations to be re-checked.
                }
            }
        }
    }

    /// Splits off the active separations with negative multipliers in the blocks of `start`, then in the blocks of the
    /// ends of each split, until none is left. Other blocks keep the non-negative multipliers they had.
    fn split_negative_in(
        &mut self,
        start: [u32; 2],
        budget: &mut Budget,
    ) -> Result<(), SolveError> {
        let mut dirty = take(&mut self.dirty);
        dirty.clear();
        dirty.extend_from_slice(&start);
        let result = self.split_negative_chain(&mut dirty, budget);
        self.dirty = dirty;
        result
    }

    fn split_negative_chain(
        &mut self,
        dirty: &mut Vec<u32>,
        budget: &mut Budget,
    ) -> Result<(), SolveError> {
        loop {
            self.negative_in(&dirty[..], MULTIPLIER_TOLERANCE);
            if self.negative.is_empty() {
                return Ok(());
            }
            budget.spend()?;
            let negative = take(&mut self.negative);
            self.split(&negative);
            dirty.clear();
            for &e in &negative {
                dirty.push(self.from[e as usize]);
                dirty.push(self.to[e as usize]);
            }
            self.negative = negative;
        }
    }

    /// Splits off every active separation with a negative multiplier. Returns false when there is none.
    fn split_negative(&mut self, budget: &mut Budget) -> Result<bool, SolveError> {
        self.multipliers();
        self.negative.clear();
        for (e, &active) in self.active.iter().enumerate() {
            if active && self.lam[e] < -MULTIPLIER_TOLERANCE {
                self.negative.push(id(e));
            }
        }
        if self.negative.is_empty() {
            return Ok(false);
        }
        budget.spend()?;
        let negative = take(&mut self.negative);
        self.split(&negative);
        self.negative = negative;
        Ok(true)
    }
}
