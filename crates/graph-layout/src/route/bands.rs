//! The tracks of each band. A run's horizontal piece runs from one in-rank coordinate to the other, on a track of its band.
//! The verticals of a run hang from its upper stop and its lower stop, so a horizontal piece crosses the verticals of the
//! runs whose tracks lie below it, where those verticals are struck inside its span. The tracks are chosen to make few of
//! those crossings, as TypeScript's `channel.ts` does:
//!
//! - Runs that leave one upper point or enter one lower point form a star, and the members of a star share a track.
//! - Each overlapping pair of stars takes the order that costs less: fewer touches (two verticals on one line) first,
//!   then fewer crossings. A pair that costs the same either way has no preference.
//! - The preferences are put in one order. Where they form a cycle, the cycle is cut at the node with the fewest unmet
//!   touch preferences, so a touch is given up only when every choice gives one up too.
//! - In that order, each star takes the lowest track below the stars that the preferences put above it, and clears the
//!   stars already on that track by `edge`.
//!
//! The pairs examined are bounded by a budget (`RouteInput::route_pairs`). Past it, the pairs left out get no preference,
//! and their stars are placed on the tracks that are free. The result depends only on the geometry of the runs, not on the
//! order of the edges: pieces are sorted by their geometry first, and identical pieces always share a star.

use std::cmp::Ordering;

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

/// One run's horizontal piece in its band: its span, and where its verticals meet the band's edges. A flat run has both
/// verticals on the band's upper edge; any other run has one on each edge.
#[derive(Debug, Clone, Copy)]
struct Piece {
    /// The edge the run belongs to, and the run's index along its stops.
    edge: usize,
    run: usize,
    /// The span of the piece along the ranks, `lo` below `hi`.
    lo: f64,
    hi: f64,
    /// The in-rank coordinates of the verticals on the band's upper edge: the first one, and the second for a flat run.
    up: [f64; 2],
    /// Whether both ends sit on the upper edge.
    flat: bool,
    /// The in-rank coordinate of the vertical on the band's lower edge; unused for a flat run.
    down: f64,
    /// The trunk of the edge: runs with one trunk never cross each other.
    trunk: Option<usize>,
}

impl Piece {
    /// The in-rank coordinates where the piece meets the band's upper edge.
    fn ups(&self) -> &[f64] {
        if self.flat { &self.up } else { &self.up[..1] }
    }

    /// The in-rank coordinates where the piece meets the band's lower edge.
    fn lows(&self) -> &[f64] {
        if self.flat {
            &[]
        } else {
            std::slice::from_ref(&self.down)
        }
    }

    /// Whether the piece may cross `other`: they must not share a trunk.
    fn crosses(&self, other: &Piece) -> bool {
        self.trunk.is_none() || self.trunk != other.trunk
    }
}

/// The order of the pieces of a band, which makes a band's result a function of its geometry alone.
fn compare(a: &Piece, b: &Piece) -> Ordering {
    a.lo.total_cmp(&b.lo)
        .then(a.hi.total_cmp(&b.hi))
        .then(a.up[0].total_cmp(&b.up[0]))
        .then(a.up[1].total_cmp(&b.up[1]))
        .then(a.down.total_cmp(&b.down))
        .then(a.flat.cmp(&b.flat))
}

/// Pieces that leave one upper point, or enter one lower point, and so share a track. `members` index the band's pieces.
#[derive(Debug, Clone)]
struct Star {
    members: Vec<usize>,
    lo: f64,
    hi: f64,
    /// The upper points every member leaves from.
    ups: Vec<f64>,
    /// The lower points every member enters.
    lows: Vec<f64>,
}

impl Star {
    /// Adds piece `index` if it still shares a point with every member, keeping only the shared points. Returns false,
    /// and changes nothing, when it shares none.
    fn admit(&mut self, index: usize, piece: &Piece) -> bool {
        let shares = |own: &[f64], theirs: &[f64]| -> Vec<f64> {
            own.iter()
                .copied()
                .filter(|p| theirs.iter().any(|q| same_coordinate(*p, *q)))
                .collect()
        };
        let ups = shares(&self.ups, piece.ups());
        let lows = shares(&self.lows, piece.lows());
        if ups.is_empty() && lows.is_empty() {
            return false;
        }
        self.members.push(index);
        self.lo = self.lo.min(piece.lo);
        self.hi = self.hi.max(piece.hi);
        self.ups = ups;
        self.lows = lows;
        true
    }
}

/// The stars of a band's sorted pieces: each piece joins the first star that shares a point with it, else starts one.
/// The stars are returned by span, so that the overlapping pairs are found by a sweep.
fn stars_of(pieces: &[Piece]) -> Vec<Star> {
    let mut stars: Vec<Star> = Vec::new();
    for (index, piece) in pieces.iter().enumerate() {
        if !stars.iter_mut().any(|star| star.admit(index, piece)) {
            stars.push(Star {
                members: vec![index],
                lo: piece.lo,
                hi: piece.hi,
                ups: piece.ups().to_vec(),
                lows: piece.lows().to_vec(),
            });
        }
    }
    stars.sort_by(|a, b| a.lo.total_cmp(&b.lo).then(a.hi.total_cmp(&b.hi)));
    stars
}

/// The overlapping pairs of stars, by index, in the order of a sweep over their spans. The sweep stops at `budget` pairs:
/// the pairs past it are left out, and get no preference.
fn overlapping_pairs(stars: &[Star], budget: usize) -> Vec<(usize, usize)> {
    let mut pairs = Vec::new();
    for (i, a) in stars.iter().enumerate() {
        for (j, b) in stars.iter().enumerate().skip(i + 1) {
            if b.lo > a.hi {
                break;
            }
            if pairs.len() >= budget {
                return pairs;
            }
            pairs.push((i, j));
        }
    }
    pairs
}

/// What one order of a pair costs: the touches it makes, then the crossings it makes. Ordered by touches first, so a
/// touch outweighs any number of crossings.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord)]
struct Cost {
    touches: usize,
    crossings: usize,
}

/// What it costs for the star `upper` to run above the star `lower`, counted over the pairs of their members.
///
/// A crossing is a horizontal piece of one run struck by a vertical of another: a lower run's upper vertical, or an
/// upper run's lower vertical, that lies strictly inside the other's span. A touch is an upper run's lower vertical on
/// the same line as a lower run's upper vertical; it is not a crossing, but the verticals would lie one on the other.
fn cost_above(pieces: &[Piece], upper: &Star, lower: &Star) -> Cost {
    let mut cost = Cost::default();
    for &m in &upper.members {
        let Some(p) = pieces.get(m) else { continue };
        for &n in &lower.members {
            let Some(q) = pieces.get(n) else { continue };
            if !p.flat {
                if q.ups().iter().any(|u| same_coordinate(*u, p.down)) {
                    cost.touches += 1;
                }
                if p.crosses(q) && q.lo < p.down && p.down < q.hi {
                    cost.crossings += 1;
                }
            }
            if p.crosses(q) {
                cost.crossings += q.ups().iter().filter(|x| p.lo < **x && **x < p.hi).count();
            }
        }
    }
    cost
}

/// The preferences over the stars: `succ[i]` lists the stars that should run below star `i`. `touch_succ[i]` is the part
/// of that list where the preference is to avoid a touch, which cycle breaking keeps whenever it can.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Preferences {
    succ: Vec<Vec<usize>>,
    touch_succ: Vec<Vec<usize>>,
}

/// The preference of each pair: the order that costs less, and no preference where both cost the same.
fn preferences(pieces: &[Piece], stars: &[Star], pairs: &[(usize, usize)]) -> Preferences {
    let mut succ: Vec<Vec<usize>> = vec![Vec::new(); stars.len()];
    let mut touch_succ: Vec<Vec<usize>> = vec![Vec::new(); stars.len()];
    for &(i, j) in pairs {
        let (Some(a), Some(b)) = (stars.get(i), stars.get(j)) else {
            continue;
        };
        let ij = cost_above(pieces, a, b);
        let ji = cost_above(pieces, b, a);
        let (upper, lower) = match ij.cmp(&ji) {
            Ordering::Less => (i, j),
            Ordering::Greater => (j, i),
            Ordering::Equal => continue,
        };
        if let Some(list) = succ.get_mut(upper) {
            list.push(lower);
        }
        if ij.touches != ji.touches
            && let Some(list) = touch_succ.get_mut(upper)
        {
            list.push(lower);
        }
    }
    Preferences { succ, touch_succ }
}

/// For each star, the number of preferences that name it as the one to run below.
fn unmet_counts(succ: &[Vec<usize>]) -> Vec<usize> {
    let mut unmet = vec![0; succ.len()];
    for list in succ {
        for &j in list {
            if let Some(count) = unmet.get_mut(j) {
                *count += 1;
            }
        }
    }
    unmet
}

/// The stars in an order that respects every preference that is not part of a cycle; ties go to the lower index. Where a
/// cycle is cut, the undone star with the fewest unmet touch preferences goes next, then the fewest unmet preferences.
fn preferred_order(prefs: &Preferences) -> Vec<usize> {
    let count = prefs.succ.len();
    let mut unmet = unmet_counts(&prefs.succ);
    let mut touch_unmet = unmet_counts(&prefs.touch_succ);
    let mut done = vec![false; count];
    let mut queue: Vec<usize> = (0..count)
        .filter(|&i| unmet.get(i).copied().unwrap_or(0) == 0)
        .collect();
    let mut order = Vec::with_capacity(count);
    let mut head = 0;
    while order.len() < count {
        if head >= queue.len() {
            queue.push(fewest_unmet(&touch_unmet, &unmet, &done));
        }
        let Some(&v) = queue.get(head) else { break };
        head += 1;
        if done.get(v).copied() == Some(false) {
            order.push(v);
            release(
                prefs,
                &mut unmet,
                &mut touch_unmet,
                &mut done,
                &mut queue,
                v,
            );
        }
    }
    order
}

/// Marks `v` done, and lowers the unmet counts of the stars it precedes; those that reach none join the queue.
fn release(
    prefs: &Preferences,
    unmet: &mut [usize],
    touch_unmet: &mut [usize],
    done: &mut [bool],
    queue: &mut Vec<usize>,
    v: usize,
) {
    if let Some(flag) = done.get_mut(v) {
        *flag = true;
    }
    for &j in prefs.touch_succ.get(v).map_or(&[][..], Vec::as_slice) {
        if let Some(count) = touch_unmet.get_mut(j) {
            *count = count.saturating_sub(1);
        }
    }
    for &j in prefs.succ.get(v).map_or(&[][..], Vec::as_slice) {
        let Some(count) = unmet.get_mut(j) else {
            continue;
        };
        *count = count.saturating_sub(1);
        if *count == 0 && done.get(j).copied() == Some(false) {
            queue.push(j);
        }
    }
}

/// The undone star with the fewest unmet touch preferences, then the fewest unmet preferences, the lowest index on a tie.
/// Returns `0` when every star is done, which the caller never asks for.
fn fewest_unmet(touch_unmet: &[usize], unmet: &[usize], done: &[bool]) -> usize {
    let weight = unmet.len() + 1;
    let score = |i: usize| {
        touch_unmet.get(i).copied().unwrap_or(0) * weight + unmet.get(i).copied().unwrap_or(0)
    };
    let mut best: Option<usize> = None;
    for i in 0..unmet.len() {
        if done.get(i).copied() == Some(false) && best.is_none_or(|b| score(i) < score(b)) {
            best = Some(i);
        }
    }
    best.unwrap_or(0)
}

/// Whether two stars on one track come closer than `edge`, end to end.
fn too_close(a: &Star, b: &Star, edge: f64) -> bool {
    a.lo < b.hi + edge && b.lo < a.hi + edge
}

/// The track of each star: in the preferred order, the lowest track below every star preferred above it that is on a track,
/// and then the first track that clears the stars already on it by `edge`.
fn assign_tracks(stars: &[Star], prefs: &Preferences, edge: f64) -> Vec<usize> {
    let mut above: Vec<Vec<usize>> = vec![Vec::new(); stars.len()];
    for (i, list) in prefs.succ.iter().enumerate() {
        for &j in list {
            if let Some(list) = above.get_mut(j) {
                list.push(i);
            }
        }
    }
    let mut tracks: Vec<Option<usize>> = vec![None; stars.len()];
    let mut occupants: Vec<Vec<usize>> = Vec::new();
    for v in preferred_order(prefs) {
        let mut t = 0;
        for &p in above.get(v).map_or(&[][..], Vec::as_slice) {
            if let Some(track) = tracks.get(p).copied().flatten() {
                t = t.max(track + 1);
            }
        }
        let Some(me) = stars.get(v) else { continue };
        while occupants.get(t).is_some_and(|others| {
            others
                .iter()
                .any(|&o| stars.get(o).is_some_and(|o| too_close(o, me, edge)))
        }) {
            t += 1;
        }
        if occupants.len() <= t {
            occupants.resize_with(t + 1, Vec::new);
        }
        if let Some(on) = occupants.get_mut(t) {
            on.push(v);
        }
        if let Some(track) = tracks.get_mut(v) {
            *track = Some(t);
        }
    }
    tracks.into_iter().map(|t| t.unwrap_or(0)).collect()
}

/// The pieces of one band, in their geometric order, from the drawn runs of the band.
fn pieces_of(input: &RouteInput, drawable: &[bool], band: usize) -> Vec<Piece> {
    let mut pieces = Vec::new();
    for (e, edge) in input.edges.iter().enumerate() {
        if !drawable.get(e).copied().unwrap_or(false) {
            continue;
        }
        for (k, pair) in edge.stops.windows(2).enumerate() {
            let [first, second] = [pair[0], pair[1]];
            let straight = same_coordinate(first.along, second.along);
            // A stub joins a lateral port's owner to its port dummy, both in one rank, and needs no track.
            let stub = first.rank == second.rank && (first.half == 0.0 || second.half == 0.0);
            if stub || straight || first.rank.min(second.rank) != band {
                continue;
            }
            let flat = first.rank == second.rank;
            let (up, down) = if flat {
                ([first.along, second.along], 0.0)
            } else {
                let (upper, lower) = if first.rank < second.rank {
                    (first, second)
                } else {
                    (second, first)
                };
                ([upper.along, upper.along], lower.along)
            };
            pieces.push(Piece {
                edge: e,
                run: k,
                lo: first.along.min(second.along),
                hi: first.along.max(second.along),
                up,
                flat,
                down,
                trunk: edge.trunk,
            });
        }
    }
    pieces.sort_by(compare);
    pieces
}

/// Gives every run of a drawable edge the track it needs. Each band's pieces are put in their geometric order, grouped
/// into stars, and their overlapping pairs take the orders that cost least (see the module's notes). A band uses as many
/// tracks as its stars need.
pub(super) fn assign(input: &RouteInput, drawable: &[bool]) -> TrackPlan {
    let mut runs: Vec<Vec<Option<usize>>> = input
        .edges
        .iter()
        .map(|edge| vec![None; edge.stops.len().saturating_sub(1)])
        .collect();
    let mut counts = vec![0; input.ranks];
    for band in 0..input.ranks {
        let pieces = pieces_of(input, drawable, band);
        let stars = stars_of(&pieces);
        let pairs = overlapping_pairs(&stars, input.route_pairs);
        let prefs = preferences(&pieces, &stars, &pairs);
        let tracks = assign_tracks(&stars, &prefs, input.edge_gap);
        for (star, &track) in stars.iter().zip(&tracks) {
            for &m in &star.members {
                let Some(piece) = pieces.get(m) else { continue };
                if let Some(slot) = runs
                    .get_mut(piece.edge)
                    .and_then(|run| run.get_mut(piece.run))
                {
                    *slot = Some(track);
                }
            }
        }
        if let Some(count) = counts.get_mut(band) {
            *count = tracks.iter().map(|t| t + 1).max().unwrap_or(0);
        }
    }
    TrackPlan { runs, counts }
}
