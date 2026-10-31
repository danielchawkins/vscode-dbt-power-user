//! Deterministic graph layout core. Only `engine`, `model`, `overview` and `pack` are public; every other module is
//! private, so a binding cannot reach an internal phase (ADR 0011, "Module boundaries").
#![forbid(unsafe_code)]

pub mod engine;
pub mod model;
pub mod overview;
pub mod pack;

// `across` and `place` are compiled for the phases (`engine::phases`); route reads only `place::boxes`.
mod across;
// `metrics` is compiled for its tests only, until the layout carries its measures.
#[cfg(test)]
mod metrics;
mod place;
// `budget`, `constraints` (its `components`), `index`, `layering`, `order`, `rand` and `solve` are compiled for the
// layout phases (`engine::phases`). `hash` is still compiled for its tests only, until a phase uses it.
mod budget;
mod constraints;
#[cfg(test)]
mod hash;
mod index;
mod layering;
#[cfg(test)]
mod layering_checks;
mod order;
#[cfg(test)]
mod order_checks;
#[cfg(test)]
mod place_checks;
mod rand;
mod route;
mod solve;
#[cfg(test)]
mod solve_checks;
#[cfg(test)]
mod testkit;
