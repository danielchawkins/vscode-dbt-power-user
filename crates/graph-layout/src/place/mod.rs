//! Coordinates from the order and the separation solver: the in-rank placement of each rank, a port of
//! `packages/graph-layout/src/place/` (ADR 0011, module table). `place` imports only `solve`, `across`, `order` and
//! `index` (rule `rust-core-layer-imports-place`), so its input is the plain `Problem` of `problem`, which the caller
//! states from the layered graph.
//!
//! Built in steps. Step 2: the Brandes and Köpf start (`alignment`, `compaction`, `brandes_koepf`) and the projection (`projection`).
//! Step 3: the objective (`terms`) and the gradient-projection search (`quadratic`). Not yet ported: the boxes and
//! `across`.

#[cfg(test)]
mod alignment;
#[cfg(test)]
mod box_gaps;
#[cfg(test)]
mod box_order;
#[cfg(test)]
mod box_rects;
#[cfg(test)]
mod boxes;
#[cfg(test)]
mod brandes_koepf;
#[cfg(test)]
mod compaction;
#[cfg(test)]
mod gaps;
#[cfg(test)]
mod hints;
#[cfg(test)]
mod offsets;
#[cfg(test)]
mod problem;
#[cfg(test)]
mod projection;
#[cfg(test)]
mod quadratic;
#[cfg(test)]
mod terms;
