//! The cluster boxes of the re-stacked ranks. A box's extent across the ranks comes from the ranks its members span, padded
//! and topped by its label; a parent box grows to hold its children. Its edges along the ranks are those placement chose.

use super::stack::Stacked;
use super::{ClusterInput, Rect, RouteInput};

/// The rectangle of each cluster box, in the order of the plan's boxes.
pub(super) fn boxes(input: &RouteInput, stacked: &Stacked) -> Vec<Rect> {
    let mut extent: Vec<(f64, f64)> = input
        .clusters
        .iter()
        .map(|cluster| {
            (
                stacked.centre(cluster.top)
                    - stacked.half(cluster.top)
                    - cluster.padding
                    - cluster.label_height,
                stacked.centre(cluster.bottom) + stacked.half(cluster.bottom) + cluster.padding,
            )
        })
        .collect();
    for i in deepest_first(&input.clusters) {
        let Some(parent) = input.clusters.get(i).and_then(|c| c.parent) else {
            continue;
        };
        let Some(padding) = input.clusters.get(parent).map(|p| p.padding) else {
            continue;
        };
        let (top, bottom) = extent[i];
        if let Some(outer) = extent.get_mut(parent) {
            outer.0 = outer.0.min(top - padding);
            outer.1 = outer.1.max(bottom + padding);
        }
    }
    input
        .clusters
        .iter()
        .zip(extent)
        .map(|(cluster, (top, bottom))| {
            // Along the ranks runs the box's width when they run down, and its height when they run right.
            let (along, across) = (cluster.right - cluster.left, bottom - top);
            if input.down {
                Rect {
                    x: cluster.left,
                    y: top,
                    width: along,
                    height: across,
                }
            } else {
                Rect {
                    x: top,
                    y: cluster.left,
                    width: across,
                    height: along,
                }
            }
        })
        .collect()
}

/// The box indices ordered so that every box comes before its ancestors: the deepest first, and in index order within a
/// depth. A chain longer than the list is a cycle, and stops there.
fn deepest_first(clusters: &[ClusterInput]) -> Vec<usize> {
    let depth = |start: usize| {
        let mut depth = 0;
        let mut at = clusters.get(start).and_then(|c| c.parent);
        while let Some(parent) = at {
            if depth > clusters.len() {
                break;
            }
            depth += 1;
            at = clusters.get(parent).and_then(|c| c.parent);
        }
        depth
    };
    let mut order: Vec<usize> = (0..clusters.len()).collect();
    order.sort_by_key(|&i| std::cmp::Reverse(depth(i)));
    order
}
