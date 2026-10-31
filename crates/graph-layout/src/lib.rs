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
mod place;
// `budget`, `hash`, `index`, `layering`, `order`, `rand` and `solve` are compiled for their tests until the
// layout phases use them; a non-test build would otherwise report their items as dead code.
#[cfg(test)]
mod budget;
#[cfg(test)]
mod constraints;
#[cfg(test)]
mod hash;
#[cfg(test)]
mod index;
#[cfg(test)]
mod layering;
#[cfg(test)]
mod layering_checks;
#[cfg(test)]
mod order;
#[cfg(test)]
mod order_checks;
#[cfg(test)]
mod rand;
mod route;
#[cfg(test)]
mod solve;
#[cfg(test)]
mod solve_checks;
#[cfg(test)]
mod testkit;
