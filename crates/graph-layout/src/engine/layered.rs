//! The layered graph that ordering reads, built from the bundles and dummy chains of `layer`: the port dummies of lateral
//! ports, the segments that link each chain's ends, the blocks and cluster paths of each node, and the spine dummies
//! that keep each cluster present in every rank it spans. A port of the ordering part of `packages/graph-layout/src/
//! layering.ts` and `spines.ts`. Imports the layering types and the model only.

use crate::layering::layered::{LayeredGraph, LayeredNode, PortDummy, Segment};
use crate::layering::{Bundle, ChainNode, Layers};
use crate::model::{Direction, Graph, Options};

/// Space between two parallel edges, used when `Spacing` leaves it out.
const DEFAULT_EDGE_SPACING: f64 = 4.0;

/// A count as a float. Graphs have far fewer than `u32::MAX` members, so the fallback never applies.
fn size(n: usize) -> f64 {
    f64::from(u32::try_from(n).unwrap_or(u32::MAX))
}

/// The side names for a direction: the lateral sides `(before, after)`, the side facing the next rank, and the side
/// facing the previous one.
struct Sides {
    before: &'static str,
    after: &'static str,
    toward_lower: &'static str,
    toward_upper: &'static str,
}

fn sides(direction: Direction) -> Sides {
    match direction {
        Direction::Down => Sides {
            before: "west",
            after: "east",
            toward_lower: "south",
            toward_upper: "north",
        },
        Direction::Right => Sides {
            before: "north",
            after: "south",
            toward_lower: "east",
            toward_upper: "west",
        },
    }
}

/// The per-node tables the builder reads: each node's port rows and its extent in the rank's axis.
struct Tables<'a> {
    graph: &'a Graph,
    sides: Sides,
    ports_of: Vec<Vec<usize>>,
    breadth: Vec<f64>,
}

impl Tables<'_> {
    /// The port row of `port` on `node`, when it names one.
    fn port(&self, node: usize, port: Option<&String>) -> Option<usize> {
        let id = port?;
        self.ports_of[node]
            .iter()
            .copied()
            .find(|&row| self.graph.nodes.ports.id[row] == *id)
    }

    /// The port of `port` on `node` when it sits on a side lateral to the flow, with whether that side lies after the
    /// node. Other ports (and no port) need no dummy.
    fn lateral(&self, node: usize, port: Option<&String>) -> Option<(usize, bool)> {
        let row = self.port(node, port)?;
        let side = self.graph.nodes.ports.side[row].as_str();
        if side == self.sides.after {
            Some((row, true))
        } else if side == self.sides.before {
            Some((row, false))
        } else {
            None
        }
    }

    /// The mean offset of the ports that the members name at one end, from the node's centre. A member that names no
    /// port, or a port on another side, contributes zero (`meanPortOffset`).
    fn mean_offset(
        &self,
        members: &[usize],
        ports: &[Option<String>],
        node: usize,
        side: &str,
    ) -> f64 {
        let total: f64 = members
            .iter()
            .map(|&e| match self.port(node, ports[e].as_ref()) {
                Some(row) if self.graph.nodes.ports.side[row] == side => {
                    self.graph.nodes.ports.offset[row] - self.breadth[node] / 2.0
                }
                _ => 0.0,
            })
            .sum();
        total / size(members.len())
    }
}

/// Builds the layered graph from the bundles and dummy chains of `layers`. `rank` gives each real node's rank.
pub(crate) fn build(
    graph: &Graph,
    options: &Options,
    layers: &Layers,
    rank: &[usize],
) -> LayeredGraph {
    let sides = sides(options.direction);
    let spacing = options
        .spacing
        .and_then(|s| s.edge)
        .unwrap_or(DEFAULT_EDGE_SPACING);
    let node_count = graph.nodes.id.len();
    let mut ports_of = vec![Vec::new(); node_count];
    for (row, &owner) in graph.nodes.ports.node.iter().enumerate() {
        ports_of[owner as usize].push(row);
    }
    let breadth: Vec<f64> = (0..node_count)
        .map(|i| match options.direction {
            Direction::Down => graph.nodes.width[i],
            Direction::Right => graph.nodes.height[i],
        })
        .collect();
    let tables = Tables {
        graph,
        sides,
        ports_of,
        breadth,
    };
    let mut out = LayeredGraph {
        nodes: (0..node_count)
            .map(|i| LayeredNode {
                id: Some(i),
                rank: rank[i],
                breadth: tables.breadth[i],
                port: None,
            })
            .collect(),
        segments: Vec::new(),
        block: Vec::new(),
        paths: Vec::new(),
        spines: Vec::new(),
        ranks: 0,
    };
    for bundle in &layers.bundles {
        add_bundle(&tables, spacing, bundle, rank, &mut out);
    }
    out.block = out
        .nodes
        .iter()
        .enumerate()
        .map(|(x, node)| node.port.map_or(x, |p| p.owner))
        .collect();
    out.paths = (0..out.nodes.len())
        .map(|x| chain_of_block(graph, &out, x))
        .collect();
    spines(graph, &mut out);
    out.ranks = out
        .nodes
        .iter()
        .map(|node| node.rank + 1)
        .max()
        .unwrap_or(0);
    out
}

/// Adds the nodes, segments of one bundle. A flat bundle has no dummies and no segments: only its end nodes, which
/// may be port dummies.
fn add_bundle(
    tables: &Tables,
    spacing: f64,
    bundle: &Bundle,
    rank: &[usize],
    out: &mut LayeredGraph,
) {
    let graph = tables.graph;
    let first = bundle.edges[0];
    let members = &bundle.edges;
    let count = size(members.len()).max(1.0) * spacing;
    let (upper, lower) = if bundle.reversed {
        (bundle.target, bundle.source)
    } else {
        (bundle.source, bundle.target)
    };
    let (upper_port, lower_port) = if bundle.reversed {
        (&graph.edges.target_port, &graph.edges.source_port)
    } else {
        (&graph.edges.source_port, &graph.edges.target_port)
    };
    let top = end_node(
        tables,
        out,
        upper,
        upper_port[first].as_ref(),
        true,
        count,
        rank,
    );
    let bottom = end_node(
        tables,
        out,
        lower,
        lower_port[first].as_ref(),
        bundle.flat,
        count,
        rank,
    );
    if bundle.flat {
        return;
    }
    let upper_offset = tables.mean_offset(members, upper_port, upper, tables.sides.toward_lower);
    let lower_offset = tables.mean_offset(members, lower_port, lower, tables.sides.toward_upper);
    let mut chain = vec![top];
    for (k, node) in bundle
        .chain
        .iter()
        .enumerate()
        .take(bundle.chain.len() - 1)
        .skip(1)
    {
        let ChainNode::Dummy(_) = *node else {
            unreachable!("the interior of a chain holds dummies");
        };
        // A dummy sits in the rank below its predecessor in the chain, so its rank is the upper rank plus its position.
        out.nodes.push(LayeredNode {
            id: None,
            rank: rank[upper] + k,
            breadth: count,
            port: None,
        });
        chain.push(out.nodes.len() - 1);
    }
    chain.push(bottom);
    let last = chain.len() - 1;
    for k in 0..last {
        out.segments.push(Segment {
            top: chain[k],
            bottom: chain[k + 1],
            weight: bundle.weight,
            top_offset: if k == 0 { upper_offset } else { 0.0 },
            bottom_offset: if k + 1 == last { lower_offset } else { 0.0 },
        });
    }
}

/// The node standing for one end of a bundle: a port dummy in the end's rank when the port is lateral, else the end
/// node itself.
fn end_node(
    tables: &Tables,
    out: &mut LayeredGraph,
    node: usize,
    port: Option<&String>,
    below: bool,
    count: f64,
    rank: &[usize],
) -> usize {
    let Some((row, after)) = tables.lateral(node, port) else {
        return node;
    };
    out.nodes.push(LayeredNode {
        id: None,
        rank: rank[node],
        breadth: count,
        port: Some(PortDummy {
            owner: node,
            after,
            below,
            offset: tables.graph.nodes.ports.offset[row],
        }),
    });
    out.nodes.len() - 1
}

/// The cluster chain of the block a node belongs to: the chain of its innermost cluster, outermost first. A dummy with
/// no owner has none.
fn chain_of_block(graph: &Graph, out: &LayeredGraph, x: usize) -> Vec<usize> {
    let owner = out.block[x];
    match out.nodes[owner].id {
        Some(node) => cluster_chain(graph, graph.nodes.cluster[node].as_deref()),
        None => Vec::new(),
    }
}

/// The chain of a cluster id: the clusters that contain it, outermost first, as indices into `graph.clusters`.
fn cluster_chain(graph: &Graph, cluster: Option<&str>) -> Vec<usize> {
    let mut chain = Vec::new();
    let mut id = cluster;
    while let Some(current) = id {
        let Some(n) = graph.clusters.id.iter().position(|c| c == current) else {
            break;
        };
        chain.insert(0, n);
        id = graph.clusters.parent[n].as_deref();
    }
    chain
}

/// Adds the spine dummies: for each cluster, its members in rank order, and a dummy in each rank strictly between two
/// neighbours more than one rank apart. Records each spine as the layered indices it runs through, upper member to
/// lower member, and gives each appended dummy its spine's chain.
fn spines(graph: &Graph, out: &mut LayeredGraph) {
    for c in 0..graph.clusters.id.len() {
        let mut members: Vec<usize> = (0..out.paths.len())
            .filter(|&x| out.paths[x].contains(&c))
            .collect();
        members.sort_by_key(|&x| (out.nodes[x].rank, x));
        let chain = cluster_chain(graph, Some(graph.clusters.id[c].as_str()));
        for pair in members.windows(2) {
            let (upper, lower) = (pair[0], pair[1]);
            let (top, bottom) = (out.nodes[upper].rank, out.nodes[lower].rank);
            if bottom <= top + 1 {
                continue;
            }
            let mut run = vec![upper];
            for rank in top + 1..bottom {
                out.nodes.push(LayeredNode {
                    id: None,
                    rank,
                    breadth: 0.0,
                    port: None,
                });
                out.paths.push(chain.clone());
                run.push(out.nodes.len() - 1);
            }
            run.push(lower);
            out.spines.push(run);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::build;
    use crate::index::Indexed;
    use crate::layering::{EdgeRule, layer};
    use crate::model::{Clusters, Edges, Graph, Nodes, Options, Ports};

    /// Node `a` in cluster `c` (rank 0) has an east port `p`; edge `a -> b` leaves through it; `b` (rank 2) is in `c`.
    fn graph() -> Graph {
        Graph {
            nodes: Nodes {
                id: vec!["a".to_owned(), "b".to_owned()],
                width: vec![10.0, 10.0],
                height: vec![10.0, 10.0],
                cluster: vec![Some("c".to_owned()), Some("c".to_owned())],
                partition: vec![None, None],
                ports: Ports {
                    node: vec![0],
                    id: vec!["p".to_owned()],
                    side: vec!["east".to_owned()],
                    offset: vec![3.0],
                },
            },
            edges: Edges {
                id: vec!["e".to_owned()],
                source: vec!["a".to_owned()],
                target: vec!["b".to_owned()],
                source_port: vec![Some("p".to_owned())],
                target_port: vec![None],
                kind: vec!["dependency".to_owned()],
            },
            clusters: Clusters {
                id: vec!["c".to_owned()],
                parent: vec![None],
                ..Clusters::default()
            },
        }
    }

    #[test]
    fn a_lateral_port_and_a_cluster_gap_build_port_edge_and_spine_nodes() {
        let g = graph();
        let indexed = Indexed::from_ends(2, vec![Some((0, 1))], &[true]);
        let rules = [EdgeRule {
            kind: 0,
            ranks: true,
            min_length: 1.0,
            weight: 1.0,
        }];
        let layers = layer(&indexed, &rules, &[0.0, 2.0]);
        let out = build(&g, &Options::default(), &layers, &[0, 2]);

        // Two real nodes, the port dummy of `a`, the edge dummy at rank 1 and the spine dummy at rank 1.
        assert_eq!(out.nodes.len(), 5);
        assert_eq!(
            out.nodes[2].port.map(|p| (p.owner, p.after)),
            Some((0, true))
        );
        assert_eq!(out.block[2], 0);
        assert_eq!(out.segments.len(), 2);
        // The east port faces neither rank, so it adds no offset to the segment that leaves the upper end.
        assert_eq!(out.segments[0].top_offset, 0.0);
        assert_eq!(out.spines, vec![vec![2, 4, 1]]);
        assert_eq!(out.paths[2], vec![0]);
        assert_eq!(out.paths[4], vec![0]);
        assert_eq!(out.ranks, 3);
    }
}
