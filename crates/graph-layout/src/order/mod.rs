//! Node order within each layer: the ordering phase of the layout, a port of `packages/graph-layout/src/order/`.
//!
//! Built in steps. Step 1: the model, the crossing count on the Fenwick tree (`fenwick`, which the ADR puts under
//! `order`), and the exact oracle (`exact`, test-only). Step 2: the clusters, starting order, sweeps, transposition,
//! sifting and the run (`run`). The input is the layered graph that `layer()` builds: its spine dummies, cluster paths
//! and blocks come from there (`spines.ts` builds the spines during layering, and `order` only reads them). Not yet
//! ported: lateral port dummies (the run asserts there are none) and `keepOutside`, which returns its input unchanged
//! here: the box-avoidance pass that needs opaque cluster boxes is not in this port.

mod clusters;
mod crossings;
#[cfg(test)]
mod exact;
mod fenwick;
#[cfg(test)]
mod fenwick_tests;
mod model;
mod run;
mod seed;
mod sifting;
mod sweeps;
mod transpose;

#[cfg(test)]
mod tests;

#[cfg(test)]
pub(crate) use crossings::total_crossings;
#[cfg(test)]
pub(crate) use exact::exact_minimum_crossings;
#[cfg(test)]
pub(crate) use model::{OrderModel, units_of};
#[cfg(test)]
pub(crate) use run::order;
#[cfg(test)]
pub(crate) use seed::Hints;
