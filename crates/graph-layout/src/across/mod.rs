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

/// Each rank's half-thickness across the drawing, its centre, and each node's half-extent across the ranks.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AcrossLayout {
    pub(crate) rank_half: Vec<f64>,
    pub(crate) centres: Vec<f64>,
    pub(crate) half: Vec<f64>,
}

/// The across layout of the rows: the half-thickness of each rank, the rank centres with `gaps[r]` between rank `r` and
/// the next, and each node's half-extent. `ranks[i]` is node `i`'s rank and `extent[i]` its full extent across the ranks
/// (0 for a dummy). `rank_count` is the number of ranks, so a rank with no node still has a centre.
pub(crate) fn across_layout(
    ranks: &[usize],
    rank_count: usize,
    extent: &[f64],
    gaps: &[f64],
) -> AcrossLayout {
    let half: Vec<f64> = extent.iter().map(|e| e / 2.0).collect();
    let mut rank_half = vec![0.0_f64; rank_count];
    for (&r, &h) in ranks.iter().zip(&half) {
        rank_half[r] = rank_half[r].max(h);
    }
    let centres = rank_centres(&rank_half, gaps);
    AcrossLayout {
        rank_half,
        centres,
        half,
    }
}

/// Each node's across position in the drawing's frame, and the shift the rows took. The rows take each node's rank
/// centre; an anchor's rank lands at the origin.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AcrossOfRows {
    pub(crate) across: Vec<f64>,
    pub(crate) shift: f64,
}

/// Each node's across position for `ranks: "rows"`: its rank's centre, shifted so that the anchor's rank is at the
/// origin when there is an anchor.
pub(crate) fn across_of_rows(
    ranks: &[usize],
    centres: &[f64],
    anchor: Option<usize>,
) -> AcrossOfRows {
    let shift = anchor.map_or(0.0, |a| -centres[ranks[a]]);
    AcrossOfRows {
        across: ranks.iter().map(|&r| centres[r] + shift).collect(),
        shift,
    }
}

/// The anchor's index among the layered nodes, or `None` when no anchor is set or no node has its id. A dummy has no
/// id, so it never matches.
pub(crate) fn anchor_index(ids: &[Option<&str>], anchor: Option<&str>) -> Option<usize> {
    let anchor = anchor?;
    ids.iter().position(|id| *id == Some(anchor))
}
