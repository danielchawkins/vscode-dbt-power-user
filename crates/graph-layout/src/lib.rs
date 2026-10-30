//! Deterministic graph layout core. Only `engine`, `model`, `overview` and `pack` are public; every other module is
//! private, so a binding cannot reach an internal phase (ADR 0011, "Module boundaries").
#![forbid(unsafe_code)]

pub mod engine;
pub mod model;
pub mod overview;
pub mod pack;

mod across;
mod budget;
mod hash;
mod index;
mod layering;
mod metrics;
mod order;
mod place;
// `rand` is compiled for its fixture tests until the layout phases draw from it (Phase 2); a non-test build would
// otherwise report its items as dead code.
#[cfg(test)]
mod rand;
mod route;
mod solve;
#[cfg(test)]
mod testkit;
