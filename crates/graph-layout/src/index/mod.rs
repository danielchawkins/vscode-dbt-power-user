//! Dense ids, CSR adjacency and component ids of a graph: the `Indexed` view of `packages/graph-layout/src/indexed.ts`.
//!
//! Node and edge indices follow the input order (ADR 0011, determinism rule 6). Components are numbered from zero in the
//! order of their first node, as `componentsOf` numbers them: the union-find root of each component is its smallest
//! node index. This module imports only `model` (ADR 0011, rule `rust-core-layer-imports-index`).

#[cfg(test)]
mod tests;

use std::collections::BTreeMap;

use crate::model::{EdgeKindPolicy, Graph, Options};

/// The index of `i` as a `u32`. Graphs have far fewer than `u32::MAX` nodes or edges, so the fallback never applies.
fn id(i: usize) -> u32 {
    u32::try_from(i).unwrap_or(u32::MAX)
}

/// Whether a node is left out of the components. No node is excluded yet: Phase 9b gives this hook its meaning, and
/// until then it changes no component.
fn excluded(_node: u32) -> bool {
    false
}

/// Whether an edge of a kind with `policy` joins its ends for the components: its kind ranks, or it is routed. An
/// edge of a kind with no policy joins them.
fn policy_joins(policy: Option<&EdgeKindPolicy>) -> bool {
    policy.is_none_or(|p| p.ranks || p.routed != Some(false))
}

/// The dense view of one graph: node and edge indices, the endpoints of each edge, CSR adjacency in both directions,
/// and the component of each node.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Indexed {
    node_index: BTreeMap<String, u32>,
    ends: Vec<Option<(u32, u32)>>,
    out_start: Vec<usize>,
    out_edges: Vec<u32>,
    in_start: Vec<usize>,
    in_edges: Vec<u32>,
    component: Vec<u32>,
    components: u32,
}

impl Indexed {
    /// The view of `graph`. With `options`, an edge joins its ends for the components only when its kind ranks or is
    /// routed; without them, every edge joins its ends. A duplicate node id maps to its last index, as `Map` does.
    pub(crate) fn new(graph: &Graph, options: Option<&Options>) -> Self {
        let node_index: BTreeMap<String, u32> = graph
            .nodes
            .id
            .iter()
            .enumerate()
            .map(|(i, node)| (node.clone(), id(i)))
            .collect();
        let ends = graph
            .edges
            .source
            .iter()
            .zip(&graph.edges.target)
            .map(|(source, target)| Some((*node_index.get(source)?, *node_index.get(target)?)))
            .collect::<Vec<_>>();
        let joins: Vec<bool> = graph
            .edges
            .kind
            .iter()
            .map(|kind| match options {
                None => true,
                Some(options) => policy_joins(options.edge_kinds.get(kind)),
            })
            .collect();
        let mut indexed = Self::from_ends(graph.nodes.id.len(), ends, &joins);
        indexed.node_index = node_index;
        indexed
    }

    /// The view of a graph with `node_count` nodes whose edge `e` runs between the ends `ends[e]` (`None` when an end
    /// is not a node: such an edge joins nothing and is in no adjacency list). `joins[e]` says whether edge `e` joins
    /// its ends for the components.
    pub(crate) fn from_ends(
        node_count: usize,
        ends: Vec<Option<(u32, u32)>>,
        joins: &[bool],
    ) -> Self {
        let component = components(node_count, &ends, joins);
        let components = component.iter().copied().max().map_or(0, |c| c + 1);
        let (out_start, out_edges) = adjacency(node_count, &ends, |(from, _)| from);
        let (in_start, in_edges) = adjacency(node_count, &ends, |(_, to)| to);
        Self {
            node_index: BTreeMap::new(),
            ends,
            out_start,
            out_edges,
            in_start,
            in_edges,
            component,
            components,
        }
    }

    /// The number of nodes.
    pub(crate) fn node_count(&self) -> usize {
        self.component.len()
    }

    /// The number of edges, including those with an end that is not a node.
    pub(crate) fn edge_count(&self) -> usize {
        self.ends.len()
    }

    /// The dense index of the node with `id`, or `None` for an id that is not a node.
    pub(crate) fn node(&self, id: &str) -> Option<u32> {
        self.node_index.get(id).copied()
    }

    /// The endpoints of edge `edge`, as node indices (source, target), or `None` when one is not a node.
    pub(crate) fn ends(&self, edge: usize) -> Option<(u32, u32)> {
        self.ends[edge]
    }

    /// The edges leaving `node`, in input order.
    pub(crate) fn out_edges(&self, node: usize) -> &[u32] {
        &self.out_edges[self.out_start[node]..self.out_start[node + 1]]
    }

    /// The edges entering `node`, in input order.
    pub(crate) fn in_edges(&self, node: usize) -> &[u32] {
        &self.in_edges[self.in_start[node]..self.in_start[node + 1]]
    }

    /// The component of `node`, numbered from zero in the order of each component's first node.
    pub(crate) fn component(&self, node: usize) -> u32 {
        self.component[node]
    }

    /// The number of components.
    pub(crate) fn component_count(&self) -> u32 {
        self.components
    }
}

/// The component of each node, by union-find over the joining edges with known ends. Each root is the smallest index of
/// its component, so the components are numbered in the order of their first node.
fn components(node_count: usize, ends: &[Option<(u32, u32)>], joins: &[bool]) -> Vec<u32> {
    let mut parent: Vec<u32> = (0..node_count).map(id).collect();
    let root = |parent: &[u32], mut r: u32| {
        while parent[r as usize] != r {
            r = parent[r as usize];
        }
        r
    };
    for (end, joined) in ends.iter().zip(joins) {
        let Some((a, b)) = *end else { continue };
        if !joined || excluded(a) || excluded(b) {
            continue;
        }
        let (ra, rb) = (root(&parent, a), root(&parent, b));
        if ra != rb {
            parent[ra.max(rb) as usize] = ra.min(rb);
        }
    }
    let mut numbers = vec![u32::MAX; node_count];
    let mut next = 0;
    (0..node_count)
        .map(|i| {
            let r = root(&parent, id(i)) as usize;
            if numbers[r] == u32::MAX {
                numbers[r] = next;
                next += 1;
            }
            numbers[r]
        })
        .collect()
}

/// CSR adjacency: the edges grouped by `key(ends)`, each group in input order. Edges with an unknown end are left out.
fn adjacency(
    node_count: usize,
    ends: &[Option<(u32, u32)>],
    key: impl Fn((u32, u32)) -> u32,
) -> (Vec<usize>, Vec<u32>) {
    let mut start = vec![0usize; node_count + 1];
    for &pair in ends.iter().flatten() {
        start[key(pair) as usize + 1] += 1;
    }
    for i in 0..node_count {
        start[i + 1] += start[i];
    }
    let mut fill = start.clone();
    let mut list = vec![0u32; start[node_count]];
    for (e, end) in ends.iter().enumerate() {
        if let Some(pair) = *end {
            let slot = &mut fill[key(pair) as usize];
            list[*slot] = id(e);
            *slot += 1;
        }
    }
    (start, list)
}
