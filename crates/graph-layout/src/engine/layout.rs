//! The layout of a graph, as `layout` in `packages/graph-layout/src/layout.ts` runs it: validate the input, run every phase
//! (`run_phases`), and assemble the result as `resultOf` does in `packages/graph-layout/src/result.ts`. Nothing here runs a
//! phase or changes its output: the result is a pure function of the graph and the options.

#[cfg(test)]
mod bench;
#[cfg(test)]
mod tests;

use std::collections::{BTreeMap, BTreeSet};

use super::handle::{Engine, Generation};
use super::phases::{PhaseError, PhasesRef};
use crate::index::Indexed;
use crate::metrics::{Drawing, DrawnPath, Opaque, measure};
use crate::model::{
    ClusterRects, EdgeLayouts, Graph, Hints, InputError, Layout, NodeLayouts, Options,
    PartitionRects, Partitions, Point, Rect,
};
use crate::route::EdgeRoute;

/// Why `layout` refused a graph.
#[derive(Debug, Clone, PartialEq)]
pub enum LayoutError {
    /// The input is not valid: every issue `validate` found, in the order it found them.
    Input(InputError),
    /// The phases do not run on the input: see [`PhaseError`].
    Phases(PhaseError),
}

/// Lays out `graph` with `options`: validates it, runs every phase and assembles the layout. This is a fresh
/// [`Engine`] run to the end, so it is the handle's result on the same inputs.
///
/// # Errors
///
/// Returns [`LayoutError::Input`] with every issue `validate` finds in the graph or the options, and
/// [`LayoutError::Phases`] when the phases do not run on a valid graph.
pub fn layout(graph: &Graph, options: &Options) -> Result<Layout, LayoutError> {
    match Engine::new().layout(graph, options, Generation::default())? {
        Some(progress) => Ok(progress.into_layout()),
        None => {
            unreachable!("a fresh engine has no newer generation, so its run is never superseded")
        }
    }
}

/// The result of the phases, as `resultOf` assembles it: the nodes, the edges, the clusters, the partitions, the bounds,
/// the hints and the metrics. The inputs are validated by the caller.
pub(super) fn result_of(graph: &Graph, options: &Options, phases: &PhasesRef<'_>) -> Layout {
    let index = Indexed::new(graph, Some(options));
    let rects = node_rects(graph, phases);
    let slots = slots_of(phases, rects.len());
    let (edges, paths) = edges_of(graph, phases, &index);
    let boxes: Vec<Rect> = phases
        .routing
        .clusters
        .iter()
        .map(|served| rect_of(served.rect))
        .collect();
    let clusters = ClusterRects {
        id: phases
            .routing
            .clusters
            .iter()
            .map(|served| graph.clusters.id[served.cluster].clone())
            .collect(),
        x: boxes.iter().map(|rect| rect.x).collect(),
        y: boxes.iter().map(|rect| rect.y).collect(),
        width: boxes.iter().map(|rect| rect.width).collect(),
        height: boxes.iter().map(|rect| rect.height).collect(),
    };

    let mut points: Vec<Point> = rects.iter().flat_map(corners_of).collect();
    points.extend(boxes.iter().flat_map(corners_of));
    points.extend(paths.iter().flat_map(|path| path.points.iter().copied()));
    let bounds = hull(&points);

    let hints = Hints {
        id: graph.nodes.id.clone(),
        rank: slots.iter().map(|slot| slot.0).collect(),
        order: slots.iter().map(|slot| slot.1).collect(),
        x: rects.iter().map(|rect| rect.x).collect(),
        y: rects.iter().map(|rect| rect.y).collect(),
    };
    let nodes = NodeLayouts {
        id: graph.nodes.id.clone(),
        x: rects.iter().map(|rect| rect.x).collect(),
        y: rects.iter().map(|rect| rect.y).collect(),
        width: rects.iter().map(|rect| rect.width).collect(),
        height: rects.iter().map(|rect| rect.height).collect(),
        rank: slots.iter().map(|slot| slot.0).collect(),
        order: slots.iter().map(|slot| slot.1).collect(),
    };
    let partitions = partition_rects(graph, &rects, options);
    let metrics = measure(&Drawing {
        boxes: rects.clone(),
        paths: paths.clone(),
        opaque: Some(opaque_of(graph, phases, &paths)),
    });
    Layout {
        nodes,
        edges,
        clusters,
        partitions,
        bounds,
        hints,
        metrics,
    }
}

/// A route rectangle as a model rectangle.
fn rect_of(rect: crate::route::Rect) -> Rect {
    Rect {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
    }
}

/// The rectangle of each real node: its routed centre, minus half its size, as `nodeRects` computes it.
fn node_rects(graph: &Graph, phases: &PhasesRef<'_>) -> Vec<Rect> {
    phases
        .routing
        .nodes
        .iter()
        .enumerate()
        .map(|(node, centre)| {
            let (width, height) = (graph.nodes.width[node], graph.nodes.height[node]);
            Rect {
                x: centre.x - width / 2.0,
                y: centre.y - height / 2.0,
                width,
                height,
            }
        })
        .collect()
}

/// Each real node's rank and its index among the real nodes of that rank, by node index (`slotsOf`). Dummies are not
/// counted.
fn slots_of(phases: &PhasesRef<'_>, count: usize) -> Vec<(u32, u32)> {
    let mut slots = vec![(0, 0); count];
    for members in phases.layers {
        let mut order = 0;
        for &member in members {
            let node = &phases.layered.nodes[member];
            if let Some(id) = node.id {
                slots[id] = (count_u32(node.rank), count_u32(order));
                order += 1;
            }
        }
    }
    slots
}

/// The edge columns, and the drawn edges the metrics measure: every edge of a routed kind, in edge order. An edge with
/// no polyline is flagged and has no points; a kind with `routed: false` has no entry. `reversed` is the ranking's.
fn edges_of(
    graph: &Graph,
    phases: &PhasesRef<'_>,
    index: &Indexed,
) -> (EdgeLayouts, Vec<DrawnPath>) {
    let mut edges = EdgeLayouts {
        point_start: vec![0],
        ..EdgeLayouts::default()
    };
    let mut paths = Vec::new();
    let mut trunks: BTreeMap<(&str, &str), usize> = BTreeMap::new();
    for (e, drawn) in phases.routing.edges.iter().enumerate() {
        let (points, failed) = match drawn {
            EdgeRoute::NotRouted => continue,
            EdgeRoute::RouteFailed => (Vec::new(), true),
            EdgeRoute::Routed(points) => (
                points
                    .iter()
                    .map(|p| Point { x: p.x, y: p.y })
                    .collect::<Vec<Point>>(),
                false,
            ),
        };
        edges.id.push(graph.edges.id[e].clone());
        for point in &points {
            edges.point_x.push(point.x);
            edges.point_y.push(point.y);
        }
        edges.point_start.push(count_u32(edges.point_x.len()));
        edges
            .reversed
            .push(phases.reversed.binary_search(&e).is_ok());
        edges.route_failed.push(failed);
        if failed {
            continue;
        }
        let source = node_index(index, &graph.edges.source[e]);
        let target = node_index(index, &graph.edges.target[e]);
        // The trunk of an edge is its source port, keyed by its source node and that port, as `trunkOf` keys it.
        let trunk = graph.edges.source_port[e].as_deref().map(|port| {
            let next = trunks.len();
            *trunks
                .entry((graph.edges.source[e].as_str(), port))
                .or_insert(next)
        });
        paths.push(DrawnPath {
            points,
            source,
            target,
            trunk,
        });
    }
    (edges, paths)
}

/// The opaque boxes of the drawing, and for each drawn path the boxes it may enter: those of the clusters that hold its
/// source or its target. A path enters no other opaque box.
fn opaque_of(graph: &Graph, phases: &PhasesRef<'_>, paths: &[DrawnPath]) -> Opaque {
    let mut clusters = Vec::new();
    let mut boxes = Vec::new();
    for served in &phases.routing.clusters {
        if graph.clusters.opaque.get(served.cluster).copied().flatten() == Some(true) {
            clusters.push(served.cluster);
            boxes.push(rect_of(served.rect));
        }
    }
    let allowed = paths
        .iter()
        .map(|path| {
            let mut holders = holders_of(graph, path.source);
            holders.extend(holders_of(graph, path.target));
            clusters
                .iter()
                .enumerate()
                .filter(|(_, cluster)| holders.contains(*cluster))
                .map(|(boxed, _)| boxed)
                .collect::<BTreeSet<usize>>()
        })
        .collect();
    Opaque { boxes, allowed }
}

/// The clusters that hold a node, by index: its own cluster and each ancestor of it.
fn holders_of(graph: &Graph, node: usize) -> Vec<usize> {
    let mut holders = Vec::new();
    let mut cluster = cluster_index(
        graph,
        graph.nodes.cluster.get(node).and_then(Option::as_deref),
    );
    // A chain of parents longer than the clusters is a cycle, which `validate` refuses; the bound keeps the walk finite.
    for _ in 0..graph.clusters.id.len() {
        let Some(c) = cluster else {
            break;
        };
        holders.push(c);
        cluster = cluster_index(
            graph,
            graph.clusters.parent.get(c).and_then(Option::as_deref),
        );
    }
    holders
}

/// The index of the cluster named `id`, when it names one.
fn cluster_index(graph: &Graph, id: Option<&str>) -> Option<usize> {
    let id = id?;
    graph.clusters.id.iter().position(|c| c == id)
}

/// The index of the node named `id`. `validate` refuses an edge that names no node, so the ends of an edge always have one.
fn node_index(index: &Indexed, id: &str) -> usize {
    index
        .node(id)
        .and_then(|n| usize::try_from(n).ok())
        .expect("validate refuses an edge that names no node")
}

/// One box per partition some node sets, spanning the rectangles of its members; none when `partitions` is `none`
/// (`partitionBoxes`). The boxes are in ascending order of partition.
fn partition_rects(graph: &Graph, rects: &[Rect], options: &Options) -> PartitionRects {
    let mut out = PartitionRects::default();
    if options.partitions == Some(Partitions::None) {
        return out;
    }
    // A band is keyed by its bits, with -0 taken as 0, as the TypeScript Map keys it.
    let mut members: BTreeMap<u64, (f64, Vec<Point>)> = BTreeMap::new();
    for (node, partition) in graph.nodes.partition.iter().enumerate() {
        if let Some(band) = *partition {
            let key = band + 0.0;
            let (_, corners) = members
                .entry(key.to_bits())
                .or_insert_with(|| (key, Vec::new()));
            corners.extend(corners_of(&rects[node]));
        }
    }
    let mut boxes: Vec<(f64, Rect)> = members
        .into_values()
        .map(|(band, corners)| (band, hull(&corners)))
        .collect();
    boxes.sort_by(|a, b| a.0.total_cmp(&b.0));
    for (band, rect) in boxes {
        out.partition.push(band);
        out.x.push(rect.x);
        out.y.push(rect.y);
        out.width.push(rect.width);
        out.height.push(rect.height);
    }
    out
}

/// The top-left and bottom-right corners of a rectangle.
fn corners_of(rect: &Rect) -> [Point; 2] {
    [
        Point {
            x: rect.x,
            y: rect.y,
        },
        Point {
            x: rect.x + rect.width,
            y: rect.y + rect.height,
        },
    ]
}

/// The smallest rectangle holding every point; an empty rectangle at the origin when there are none (`hullOf`).
fn hull(points: &[Point]) -> Rect {
    if points.is_empty() {
        return Rect::default();
    }
    let (mut left, mut top) = (f64::INFINITY, f64::INFINITY);
    let (mut right, mut bottom) = (f64::NEG_INFINITY, f64::NEG_INFINITY);
    for p in points {
        left = left.min(p.x);
        top = top.min(p.y);
        right = right.max(p.x);
        bottom = bottom.max(p.y);
    }
    Rect {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    }
}

/// A count as an index of the result. Counts in a layout are far below 2^32.
fn count_u32(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}
