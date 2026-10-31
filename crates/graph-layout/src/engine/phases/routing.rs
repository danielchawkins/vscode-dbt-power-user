//! The route's input, stated from the phases. The layered graph, the placement and the options become the plain data that
//! `crate::route` reads, and `route` runs on it. A bundle's chain is the layered nodes of its segments (or its two real
//! ends when it is flat), in ranking order. Each member edge takes the chain from its own source end, and a dummy stop
//! sits at the member's slot inside the dummy's breadth.

use std::collections::BTreeMap;

use super::spacing_of;
use crate::index::Indexed;
use crate::layering::{ChainNode, LayeredGraph, Layers};
use crate::model::{Direction, Graph, Options, Ranks};
use crate::place::Placement;
use crate::route::{
    ClusterInput, EdgeInput, NodeInput, RouteInput, Routing, Stop, route, route_levels,
};

/// Routes the layout the phases placed: the rows route under `ranks: "rows"` (the default), the levels route under
/// `ranks: "levels"`.
pub(super) fn route_layout(
    graph: &Graph,
    options: &Options,
    index: &Indexed,
    layers: &Layers,
    layered: &LayeredGraph,
    placement: &Placement,
) -> Routing {
    let input = route_input(graph, options, index, layers, layered, placement);
    match options.ranks.unwrap_or_default() {
        Ranks::Rows => route(&input),
        Ranks::Levels => route_levels(&input),
    }
}

/// The plain data of the route: the nodes, the cluster boxes, the edges and the options the route reads.
fn route_input(
    graph: &Graph,
    options: &Options,
    index: &Indexed,
    layers: &Layers,
    layered: &LayeredGraph,
    placement: &Placement,
) -> RouteInput {
    let down = options.direction == Direction::Down;
    let spacing = spacing_of(options);
    let plan = &placement.boxes.plan;
    let nodes = (0..graph.nodes.id.len())
        .map(|i| NodeInput {
            rank: layered.nodes[i].rank,
            along: along_of(placement, down, i),
            across: across_of(placement, down, i),
            half: across_half(graph, down, i),
            holders: holders_of(graph, &plan.by_cluster, i),
        })
        .collect();
    let anchor_rank = options
        .anchor
        .as_deref()
        .and_then(|anchor| graph.nodes.id.iter().position(|id| id == anchor))
        .and_then(|node| layered.nodes.get(node))
        .map(|node| node.rank);
    RouteInput {
        down,
        edge_gap: spacing.edge,
        rank_gap: spacing.rank,
        ranks: layered.ranks,
        below: plan.margins.below.clone(),
        above: plan.margins.above.clone(),
        anchor_rank,
        nodes,
        clusters: cluster_inputs(graph, placement),
        edges: edges_of(graph, options, index, layers, layered, placement, down),
    }
}

/// The in-rank coordinate of a layered node's centre: its `x` when the ranks run down, else its `y`.
fn along_of(placement: &Placement, down: bool, node: usize) -> f64 {
    let point = &placement.points[node];
    if down { point.x } else { point.y }
}

/// The across-the-ranks coordinate of a layered node's centre, as placement solved it: its `y` when the ranks run down,
/// else its `x`.
fn across_of(placement: &Placement, down: bool, node: usize) -> f64 {
    let point = &placement.points[node];
    if down { point.y } else { point.x }
}

/// Half the extent of a real node across the ranks: its height going down, its width going right.
fn across_half(graph: &Graph, down: bool, node: usize) -> f64 {
    let size = if down {
        graph.nodes.height[node]
    } else {
        graph.nodes.width[node]
    };
    size / 2.0
}

/// The boxes that hold a real node: its own cluster, then each ancestor, as indices into the plan's boxes. A cluster with
/// no box takes none.
fn holders_of(graph: &Graph, by_cluster: &[Option<usize>], node: usize) -> Vec<usize> {
    let mut holders = Vec::new();
    let mut cluster = graph.nodes.cluster[node]
        .as_deref()
        .and_then(|id| cluster_index(graph, id));
    // A chain of parents longer than the clusters is a cycle, and stops there.
    for _ in 0..=graph.clusters.id.len() {
        let Some(c) = cluster else {
            break;
        };
        if let Some(Some(boxed)) = by_cluster.get(c) {
            holders.push(*boxed);
        }
        cluster = graph
            .clusters
            .parent
            .get(c)
            .and_then(Option::as_deref)
            .and_then(|id| cluster_index(graph, id));
    }
    holders
}

/// The index of the cluster named `id`.
fn cluster_index(graph: &Graph, id: &str) -> Option<usize> {
    graph.clusters.id.iter().position(|x| x == id)
}

/// The cluster boxes of the plan, in its order: their edges along the ranks and the ranks they span, with their parent box
/// and whether their cluster is opaque.
fn cluster_inputs(graph: &Graph, placement: &Placement) -> Vec<ClusterInput> {
    let plan = &placement.boxes.plan;
    let edges = &placement.boxes.edges;
    plan.boxes
        .iter()
        .enumerate()
        .map(|(b, plan_box)| ClusterInput {
            cluster: plan_box.cluster,
            left: edges.get(2 * b).copied().unwrap_or(0.0),
            right: edges.get(2 * b + 1).copied().unwrap_or(0.0),
            top: plan_box.top,
            bottom: plan_box.bottom,
            padding: plan_box.padding,
            label_height: plan_box.label_height,
            parent: plan_box
                .parent
                .and_then(|p| plan.by_cluster.get(p).copied().flatten()),
            opaque: graph
                .clusters
                .opaque
                .get(plan_box.cluster)
                .copied()
                .flatten()
                == Some(true),
            across: placement.boxes.across.as_ref().map(|solved| {
                (
                    solved.get(2 * b).copied().unwrap_or(0.0),
                    solved.get(2 * b + 1).copied().unwrap_or(0.0),
                )
            }),
        })
        .collect()
}

/// The chain of each bundle, as layered indices in ranking order. A dummy chain is read from the segments, which link
/// each stop to the next; a flat bundle has no segments, and its chain is its two real ends.
fn chains_of(layers: &Layers, layered: &LayeredGraph) -> Vec<Vec<usize>> {
    let mut chains: Vec<Vec<usize>> = vec![Vec::new(); layers.bundles.len()];
    for segment in &layered.segments {
        if let Some(chain) = chains.get_mut(segment.bundle) {
            if chain.is_empty() {
                chain.push(segment.top);
            }
            chain.push(segment.bottom);
        }
    }
    for (chain, bundle) in chains.iter_mut().zip(&layers.bundles) {
        if bundle.flat {
            *chain = bundle
                .chain
                .iter()
                .filter_map(|node| match node {
                    ChainNode::Node(real) => Some(*real),
                    ChainNode::Dummy(_) => None,
                })
                .collect();
        }
    }
    chains
}

/// Where a member edge sits in its bundle, and what its ends are: its slot among the bundle's edges and their number, its
/// real ends, and the ports it names at them.
struct Member<'a> {
    slot: usize,
    count: usize,
    source: usize,
    target: usize,
    source_port: Option<&'a str>,
    target_port: Option<&'a str>,
}

/// The edges as the route reads them, by edge index: whether the kind is routed, the real ends and the stops. An edge no
/// bundle carries (a self-loop, or an edge with unknown ends) has no stops.
fn edges_of(
    graph: &Graph,
    options: &Options,
    index: &Indexed,
    layers: &Layers,
    layered: &LayeredGraph,
    placement: &Placement,
    down: bool,
) -> Vec<EdgeInput> {
    let count = graph.edges.id.len();
    let chains = chains_of(layers, layered);
    let mut bundle_of: Vec<Option<(usize, usize, usize)>> = vec![None; count];
    for (b, bundle) in layers.bundles.iter().enumerate() {
        for (slot, &e) in bundle.edges.iter().enumerate() {
            if let Some(entry) = bundle_of.get_mut(e) {
                *entry = Some((b, slot, bundle.edges.len()));
            }
        }
    }
    let stops = Stops {
        graph,
        layered,
        placement,
        ports: ports_of(graph),
        down,
    };
    (0..count)
        .map(|e| {
            let routed = options
                .edge_kinds
                .get(&graph.edges.kind[e])
                .and_then(|p| p.routed)
                != Some(false);
            let (source, target) = index
                .ends(e)
                .map_or((0, 0), |(s, t)| (to_index(s), to_index(t)));
            let stops = match bundle_of[e] {
                Some((b, slot, n)) => {
                    let member = Member {
                        slot,
                        count: n,
                        source,
                        target,
                        source_port: graph.edges.source_port[e].as_deref(),
                        target_port: graph.edges.target_port[e].as_deref(),
                    };
                    stops.of_chain(&chains[b], &member)
                }
                None => Vec::new(),
            };
            EdgeInput {
                routed,
                source,
                target,
                stops,
            }
        })
        .collect()
}

/// A node index of the index, as a `usize`.
fn to_index(node: u32) -> usize {
    usize::try_from(node).unwrap_or(usize::MAX)
}

/// The rows of the ports, by node and port id.
fn ports_of(graph: &Graph) -> BTreeMap<(usize, &str), usize> {
    graph
        .nodes
        .ports
        .node
        .iter()
        .zip(&graph.nodes.ports.id)
        .enumerate()
        .map(|(row, (&node, id))| ((to_index(node), id.as_str()), row))
        .collect()
}

/// The stops of a chain: what the chain's layered nodes are, in the drawing.
struct Stops<'a> {
    graph: &'a Graph,
    layered: &'a LayeredGraph,
    placement: &'a Placement,
    ports: BTreeMap<(usize, &'a str), usize>,
    down: bool,
}

impl Stops<'_> {
    /// The stops of a member edge along its bundle's chain, from the edge's source end to its target end.
    fn of_chain(&self, chain: &[usize], member: &Member<'_>) -> Vec<Stop> {
        let mut stops: Vec<Stop> = (0..chain.len())
            .map(|k| self.stop(chain, k, member))
            .collect();
        if chain.first() != Some(&member.source) {
            stops.reverse();
        }
        stops
    }

    /// The stop at position `k` of the chain. A real end sits at its port when the port is on the side that faces the
    /// run it starts; otherwise at its centre. A dummy sits at the member's slot inside its breadth.
    fn stop(&self, chain: &[usize], k: usize, member: &Member<'_>) -> Stop {
        let node = chain[k];
        let layered = &self.layered.nodes[node];
        let centre = along_of(self.placement, self.down, node);
        let across = across_of(self.placement, self.down, node);
        let left = centre - layered.breadth / 2.0;
        match layered.id {
            None => Stop {
                rank: layered.rank,
                along: left
                    + (count_of(member.slot) + 0.5) * layered.breadth / count_of(member.count),
                across,
                half: 0.0,
            },
            Some(real) => {
                let facing = chain
                    .get(if k == 0 { 1 } else { k - 1 })
                    .map(|&next| self.lower_side(self.layered.nodes[next].rank >= layered.rank));
                let port_id = if real == member.source {
                    member.source_port
                } else if real == member.target {
                    member.target_port
                } else {
                    None
                };
                let row = port_id.and_then(|id| self.ports.get(&(real, id)).copied());
                let along = match (row, facing) {
                    (Some(row), Some(side)) if self.graph.nodes.ports.side[row] == side => {
                        left + self.graph.nodes.ports.offset[row]
                    }
                    _ => centre,
                };
                Stop {
                    rank: layered.rank,
                    along,
                    across,
                    half: across_half(self.graph, self.down, real),
                }
            }
        }
    }

    /// The name of the side a run leaves a node on: toward the lower rank (`south` going down, `east` going right), or
    /// toward the upper one.
    fn lower_side(&self, lower: bool) -> &'static str {
        match (self.down, lower) {
            (true, true) => "south",
            (true, false) => "north",
            (false, true) => "east",
            (false, false) => "west",
        }
    }
}

/// A count as a float. Counts here are far below 2^32.
fn count_of(n: usize) -> f64 {
    f64::from(u32::try_from(n).unwrap_or(u32::MAX))
}
