//! The crossings of a drawing: a horizontal piece and a vertical piece of two edges that cross strictly inside both, the
//! edges not sharing a trunk. A left-to-right sweep counts them (`countCrossings` and `sweepCrossings` of `metrics.ts`).

use std::collections::BTreeMap;

use super::pieces::{Pieces, Segment, same};

/// The crossings of `pieces`, whose trunks are `trunks` (aligned with `pieces`; `None` shares with no edge). One sweep
/// counts the pairs among all segments. The pairs inside each trunk group, and inside each edge with no trunk, are then
/// taken back, each group by its own sweep. The groups hold each segment once, so what they take back is a part of the
/// pairs counted, and the difference is never negative.
pub(super) fn count_crossings(pieces: &[Pieces], trunks: &[Option<usize>]) -> usize {
    let all: Vec<Segment> = pieces
        .iter()
        .flat_map(|piece| piece.segments.iter().copied())
        .collect();
    let mut total = sweep(&all);
    let mut groups: BTreeMap<usize, Vec<Segment>> = BTreeMap::new();
    for (piece, trunk) in pieces.iter().zip(trunks.iter().copied()) {
        match trunk {
            Some(trunk) => groups
                .entry(trunk)
                .or_default()
                .extend(piece.segments.iter().copied()),
            None => total -= sweep(&piece.segments),
        }
    }
    for group in groups.values() {
        total -= sweep(group);
    }
    usize::try_from(total).unwrap_or(0)
}

/// What the sweep does at one x.
#[derive(Debug, Clone, Copy)]
enum Kind {
    /// A horizontal piece enters (`delta` 1) or leaves (`delta` -1) the live rows, at the row `row`.
    Live { row: usize, delta: i64 },
    /// A vertical piece asks how many live rows lie strictly between `low` and `high`.
    Query { low: f64, high: f64 },
}

/// One event of the sweep, at `x`. At equal x the removals (order 0) come first, then the queries (1), then the
/// insertions (2), so a piece never counts at its own end.
#[derive(Debug, Clone, Copy)]
struct Event {
    x: f64,
    order: u8,
    kind: Kind,
}

/// The proper crossings among `segments`: pairs of a horizontal and a vertical piece that meet strictly inside both.
fn sweep(segments: &[Segment]) -> i64 {
    let mut heights: Vec<f64> = segments
        .iter()
        .filter(|s| s.horizontal)
        .map(|s| s.fixed)
        .collect();
    heights.sort_by(f64::total_cmp);
    heights.dedup_by(|a, b| same(*a, *b));
    let mut events: Vec<Event> = Vec::with_capacity(2 * segments.len());
    for s in segments {
        if s.horizontal {
            let row = heights.partition_point(|h| *h < s.fixed);
            events.push(Event {
                x: s.to,
                order: 0,
                kind: Kind::Live { row, delta: -1 },
            });
            events.push(Event {
                x: s.from,
                order: 2,
                kind: Kind::Live { row, delta: 1 },
            });
        } else {
            events.push(Event {
                x: s.fixed,
                order: 1,
                kind: Kind::Query {
                    low: s.from,
                    high: s.to,
                },
            });
        }
    }
    events.sort_by(|a, b| a.x.total_cmp(&b.x).then(a.order.cmp(&b.order)));
    let mut live = Fenwick::new(heights.len());
    let mut total = 0;
    for event in events {
        match event.kind {
            Kind::Live { row, delta } => live.add(row, delta),
            Kind::Query { low, high } => {
                let lo = heights.partition_point(|h| *h <= low);
                let hi = heights.partition_point(|h| *h < high);
                if hi > lo {
                    total += live.prefix(hi) - live.prefix(lo);
                }
            }
        }
    }
    total
}

/// A Fenwick (binary indexed) tree over signed counts: a point update and a prefix sum each take O(log n).
struct Fenwick {
    tree: Vec<i64>,
}

impl Fenwick {
    fn new(size: usize) -> Self {
        Self {
            tree: vec![0; size + 1],
        }
    }

    /// Adds `delta` to the entry at `index`.
    fn add(&mut self, index: usize, delta: i64) {
        let mut i = index + 1;
        while i < self.tree.len() {
            self.tree[i] += delta;
            i += i.isolate_lowest_one();
        }
    }

    /// The sum of the entries before `end` (indices 0 to `end` - 1).
    fn prefix(&self, end: usize) -> i64 {
        let mut sum = 0;
        let mut i = end;
        while i > 0 {
            sum += self.tree[i];
            i &= i - 1;
        }
        sum
    }
}
