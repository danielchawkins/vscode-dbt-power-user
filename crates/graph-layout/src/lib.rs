//! Deterministic graph layout core. Only `engine`, `model`, `overview` and `pack` are public; every other module is
//! private, so a binding cannot reach an internal phase (ADR 0011, "Module boundaries").
#![forbid(unsafe_code)]

pub mod engine;
pub mod model;
pub mod overview;
pub mod pack;

mod across;
mod budget;
mod index;
mod layering;
mod metrics;
mod order;
mod place;
// `hash` and `rand` are compiled for their tests until the layout phases use them (Phase 2); a non-test build would
// otherwise report their items as dead code.
#[cfg(test)]
mod hash;
#[cfg(test)]
mod rand;
mod route;
mod solve;
#[cfg(test)]
mod testkit;
