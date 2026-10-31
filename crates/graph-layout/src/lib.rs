//! Deterministic graph layout core. Only `engine`, `model`, `overview` and `pack` are public; every other module is
//! private, so a binding cannot reach an internal phase (ADR 0011, "Module boundaries").
#![forbid(unsafe_code)]

pub mod engine;
pub mod model;
pub mod overview;
pub mod pack;

// `across` is compiled for its tests until route uses it.
#[cfg(test)]
mod across;
mod metrics;
// `place` is compiled for its tests until route reads its boxes and placement.
#[cfg(test)]
mod place;
// `budget`, `index`, `layering`, `order` and `rand` are compiled for the layout phases (`engine::phases`). `constraints`,
// `hash` and `solve` are still compiled for their tests only, until a phase uses them.
mod budget;
#[cfg(test)]
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
#[cfg(test)]
mod solve;
#[cfg(test)]
mod solve_checks;
#[cfg(test)]
mod testkit;
