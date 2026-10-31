//! The tracks of each band. A run's horizontal piece runs from one in-rank coordinate to the other, on a track of its band.
//! Two pieces that overlap need two tracks; pieces that only touch, or are apart, may share one.

use super::{RouteInput, same_coordinate};

/// The track of each run, by edge and by run (the pair of adjacent stops it joins), and the tracks each band needs.
/// A run with no horizontal piece, or an edge that is not drawn, has no track.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct TrackPlan {
    /// The track of each run, by edge index, then by the run's index along the edge's stops.
    pub(super) runs: Vec<Vec<Option<usize>>>,
    /// The number of tracks each band uses, by the band's rank.
    pub(super) counts: Vec<usize>,
}

/// Gives every run of a drawable edge the track it needs. Within a band the runs are taken in order of their start, and
/// each takes the lowest track that is free before it starts, so a band uses as few tracks as its pieces need. A track is
/// free for a piece that starts strictly after the piece on it ends, so no two pieces on one track touch.
pub(super) fn assign(input: &RouteInput, drawable: &[bool]) -> TrackPlan {
    let mut runs: Vec<Vec<Option<usize>>> = input
        .edges
        .iter()
        .map(|edge| vec![None; edge.stops.len().saturating_sub(1)])
        .collect();
    // The runs of each band that have a horizontal piece: their start, their end, their edge and their index.
    let mut pieces: Vec<Vec<(f64, f64, usize, usize)>> = vec![Vec::new(); input.ranks];
    for (e, edge) in input.edges.iter().enumerate() {
        if !drawable.get(e).copied().unwrap_or(false) {
            continue;
        }
        for (k, pair) in edge.stops.windows(2).enumerate() {
            // A stub joins a lateral port's owner to its port dummy, both in one rank, and needs no track.
            let stub = pair[0].rank == pair[1].rank && (pair[0].half == 0.0 || pair[1].half == 0.0);
            let (from, to) = (pair[0].along, pair[1].along);
            if stub || same_coordinate(from, to) {
                continue;
            }
            let band = pair[0].rank.min(pair[1].rank);
            if let Some(list) = pieces.get_mut(band) {
                list.push((from.min(to), from.max(to), e, k));
            }
        }
    }
    let mut counts = vec![0; input.ranks];
    for (band, mut list) in pieces.into_iter().enumerate() {
        // A stable sort by start keeps the input order for equal starts, so the tracks are the same on every run.
        list.sort_by(|a, b| a.0.total_cmp(&b.0));
        let mut ends: Vec<f64> = Vec::new();
        for (start, end, e, k) in list {
            let track = if let Some(free) = ends.iter().position(|&last| last < start) {
                ends[free] = end;
                free
            } else {
                ends.push(end);
                ends.len() - 1
            };
            if let Some(slot) = runs.get_mut(e).and_then(|run| run.get_mut(k)) {
                *slot = Some(track);
            }
        }
        if let Some(count) = counts.get_mut(band) {
            *count = ends.len();
        }
    }
    TrackPlan { runs, counts }
}
