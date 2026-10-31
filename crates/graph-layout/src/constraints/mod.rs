//! One axis of a layout, a port of `packages/graph-layout/src/constraints/` except the solver. A problem is variables with
//! a desired position and a weight, and the constraints among them: separations, and equalities that hold exactly.
//! Equalities are reduced to one variable per class before the solver sees the problem (`equalities`); a separation
//! cycle that the merge closes is reported by name (`cycles`).
//!
//! The solver itself is `solve` (Phase 2). This module imports nothing from `solve` except its `Separation` type, so the
//! reduction can be read and tested apart from the solve loop.

mod components;
mod cycles;
mod equalities;
#[cfg(test)]
mod tests;

pub(crate) use components::components;
pub(crate) use cycles::cyclic_classes;
pub(crate) use equalities::reduce_equalities;

/// A constraint between two variables: `x[to] - x[from] >= gap`, or `x[to] - x[from] = gap` when `equality` is set.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Constraint {
    /// The variable on the low side.
    pub(crate) from: usize,
    /// The variable on the high side.
    pub(crate) to: usize,
    /// The minimum (or exact value) of `x[to] - x[from]`.
    pub(crate) gap: f64,
    /// Holds exactly, as an alignment does, rather than as a least distance.
    pub(crate) equality: bool,
}

/// The variables of one axis and the constraints among them. `desired` and `weight` have one entry per variable.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AxisProblem {
    /// Each variable's desired position.
    pub(crate) desired: Vec<f64>,
    /// Each variable's weight: the cost of moving it away from its desired position. Strictly positive.
    pub(crate) weight: Vec<f64>,
    /// The constraints, in input order.
    pub(crate) constraints: Vec<Constraint>,
}

/// Why an axis problem is refused.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum ConstraintError {
    /// A constraint names a variable outside `0..desired.len()`.
    IndexOutOfRange {
        /// The index named.
        index: usize,
        /// The number of variables.
        variables: usize,
    },
    /// Equalities put one variable at two offsets from the same root.
    Contradiction {
        /// The variable reached a second time.
        variable: usize,
        /// The offset the chain through `through` forces.
        forced: f64,
        /// The offset the first chain gave it.
        found: f64,
    },
    /// Merging equal variables closes a cycle of separations, which the solver cannot take.
    Cycle {
        /// The variables whose classes lie on the cycle, in index order.
        variables: Vec<usize>,
    },
}

impl std::fmt::Display for ConstraintError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::IndexOutOfRange { index, variables } => {
                write!(
                    f,
                    "variable index {index} is outside 0..{}",
                    variables.saturating_sub(1)
                )
            }
            Self::Contradiction {
                variable,
                forced,
                found,
            } => write!(
                f,
                "equalities contradict each other: variable {variable} is forced {forced}, and {found} through another chain"
            ),
            Self::Cycle { variables } => write!(
                f,
                "separations form a cycle once equal variables are merged, which the solver cannot take: {variables:?}"
            ),
        }
    }
}
