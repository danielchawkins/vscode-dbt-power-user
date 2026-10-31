//! The re-stacked ranks: each band's height from its tracks, and the centre of each rank across the drawing.

use super::{RouteInput, count};

/// The ranks stacked across the drawing: each rank's centre and half-extent, and the top of each band's tracks.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Stacked {
    /// The centre of each rank across the drawing, the anchor's rank moved to the origin.
    centres: Vec<f64>,
    /// Half the extent of each rank's tallest node across the drawing.
    halves: Vec<f64>,
    /// The margin each rank's boxes take below it, before its band's tracks.
    below: Vec<f64>,
}

impl Stacked {
    /// The centre of `rank` across the drawing; zero for a rank the route does not have.
    pub(super) fn centre(&self, rank: usize) -> f64 {
        self.centres.get(rank).copied().unwrap_or(0.0)
    }

    /// Half the extent of the tallest node of `rank` across the drawing; zero for a rank the route does not have.
    pub(super) fn half(&self, rank: usize) -> f64 {
        self.halves.get(rank).copied().unwrap_or(0.0)
    }

    /// The first track of the band below `rank`: the rank's bottom, plus the margin under it.
    pub(super) fn band_top(&self, rank: usize) -> f64 {
        self.centre(rank) + self.half(rank) + self.below.get(rank).copied().unwrap_or(0.0)
    }
}

/// Stacks the ranks: each rank's half-extent is that of its tallest node, and each band between two ranks is as tall as
/// its margins and its tracks need. `tracks` gives the tracks each band needs. Ranks run from the top of the drawing at
/// zero; the anchor's rank is then moved to the origin.
pub(super) fn stack(input: &RouteInput, tracks: &[usize]) -> Stacked {
    let halves = rank_halves(input);
    let mut centres = Vec::with_capacity(input.ranks);
    let mut top = 0.0;
    for (rank, &half) in halves.iter().enumerate() {
        centres.push(top + half);
        top += 2.0 * half + gap_below(input, tracks, rank);
    }
    let shift = input
        .anchor_rank
        .and_then(|rank| centres.get(rank).copied())
        .map_or(0.0, |centre| -centre);
    for centre in &mut centres {
        *centre += shift;
    }
    Stacked {
        centres,
        halves,
        below: input.below.clone(),
    }
}

/// The half-extent of the tallest real node of each rank, zero for a rank with none.
fn rank_halves(input: &RouteInput) -> Vec<f64> {
    let mut halves = vec![0.0_f64; input.ranks];
    for node in &input.nodes {
        if let Some(half) = halves.get_mut(node.rank) {
            *half = half.max(node.half);
        }
    }
    halves
}

/// The space between `rank`'s bottom and the next rank's top: the margin below `rank`, the band's height and the margin
/// above the next rank. The last rank has no band below it that stacks, so it has no gap.
fn gap_below(input: &RouteInput, tracks: &[usize], rank: usize) -> f64 {
    if rank + 1 >= input.ranks {
        return 0.0;
    }
    let below = input.below.get(rank).copied().unwrap_or(0.0);
    let above = input.above.get(rank + 1).copied().unwrap_or(0.0);
    below + band_height(input, tracks, rank) + above
}

/// The height of the band below `rank`: its tracks at `edge` spacing with one `edge` to spare, and at least the rank gap.
/// A band with no track is the rank gap, except below the last rank, where it is nothing.
fn band_height(input: &RouteInput, tracks: &[usize], rank: usize) -> f64 {
    let used = tracks.get(rank).copied().unwrap_or(0);
    if used == 0 && rank + 1 == input.ranks {
        return 0.0;
    }
    input.rank_gap.max(count(used + 1) * input.edge_gap)
}
