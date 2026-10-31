//! Across-axis wrapping of the layered order, a port of `packages/graph-layout/src/place/across.ts` for `ranks: "rows"`.
//!
//! `across` may import only `index` and the output types of `order` (ADR 0011, module table), so the layered graph
//! reaches it as plain data: each node's rank and its extent across the ranks. `place` imports these functions from
//! here, which is why `rankCentres` lives in this module and not in `place`.

#[cfg(test)]
mod tests;

/// The centre of each rank across the drawing: ranks are stacked from the origin, with `gaps[r]` between rank `r` and the
/// next. A rank past the end of `gaps` has no gap after it, as `gaps[r] ?? 0` gives in TypeScript.
pub(crate) fn rank_centres(half: &[f64], gaps: &[f64]) -> Vec<f64> {
    let mut centres = Vec::with_capacity(half.len());
    let mut edge = 0.0;
    for (r, &h) in half.iter().enumerate() {
        centres.push(edge + h);
        edge += 2.0 * h + gaps.get(r).copied().unwrap_or(0.0);
    }
    centres
}
