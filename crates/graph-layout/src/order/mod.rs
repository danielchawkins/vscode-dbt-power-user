//! Node order within each layer: the ordering phase of the layout, a port of `packages/graph-layout/src/order/`.
//! Built in steps: the model, the crossing count (`crossings`, reading the Fenwick tree) and the exact oracle (`exact`,
//! test-only) come first; the sweeps, sifting, restarts and hints follow.

mod crossings;
#[cfg(test)]
mod exact;
mod fenwick;
#[cfg(test)]
mod fenwick_tests;
mod model;
#[cfg(test)]
mod tests;

#[cfg(test)]
pub(crate) use crossings::total_crossings;
#[cfg(test)]
pub(crate) use exact::exact_minimum_crossings;
#[cfg(test)]
pub(crate) use model::{OrderModel, units_of};
