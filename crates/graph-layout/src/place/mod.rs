//! Coordinates from the order and the separation solver: the in-rank placement of each rank, a port of
//! `packages/graph-layout/src/place/` (ADR 0011, module table). `place` imports only `solve`, `across`, `order` and
//! `index` (rule `rust-core-layer-imports-place`), so its input is the plain `Problem` of `problem`, which the caller
//! states from the layered graph.
//!
//! Built in steps. Step 2 (this one): the Brandes and Köpf start (`alignment`, `compaction`, `brandes_koepf`) and the
//! rank projection (`projection`). Not yet ported: the quadratic and gradient projection, the boxes and `across`.

#[cfg(test)]
mod alignment;
#[cfg(test)]
mod brandes_koepf;
#[cfg(test)]
mod compaction;
#[cfg(test)]
mod offsets;
#[cfg(test)]
mod problem;
#[cfg(test)]
mod projection;
