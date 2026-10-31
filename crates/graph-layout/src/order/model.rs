//! The state the ordering searches: each rank's units from left to right, and the segments that link each node to the ranks
//! above and below. `layers` is the only part a search changes; `index` follows it. A port of `order/model.ts`.

use std::cmp::Ordering;

use crate::layering::LayeredGraph;

/// Share of a node's breadth a port's offset may move a link, so the position stays inside the node's span.
const PORT_SHARE: f64 = 0.9;

/// The ordering state: `layers` as its order, indexed and linked to the segments of `graph`.
#[derive(Debug, Clone)]
pub(crate) struct OrderModel<'a> {
    pub(crate) graph: &'a LayeredGraph,
    /// Layered node indices per rank, left to right.
    pub(crate) layers: Vec<Vec<usize>>,
    /// Each node's index in its rank.
    pub(crate) index: Vec<usize>,
    /// Segments whose upper end is the node: its links to the rank below.
    pub(crate) down: Vec<Vec<usize>>,
    /// Segments whose lower end is the node: its links to the rank above.
    pub(crate) up: Vec<Vec<usize>>,
}

impl<'a> OrderModel<'a> {
    /// The model with `layers` as its order. Its segment lists are built once, from `graph`.
    pub(crate) fn new(graph: &'a LayeredGraph, layers: Vec<Vec<usize>>) -> Self {
        let count = graph.nodes.len();
        let mut down = vec![Vec::new(); count];
        let mut up = vec![Vec::new(); count];
        for (si, s) in graph.segments.iter().enumerate() {
            down[s.top].push(si);
            up[s.bottom].push(si);
        }
        let mut model = Self {
            graph,
            layers,
            index: vec![0; count],
            down,
            up,
        };
        for rank in 0..model.layers.len() {
            model.reindex(rank);
        }
        model
    }

    /// Replaces the order of one rank and updates the indices of its nodes.
    pub(crate) fn set_layer(&mut self, rank: usize, order: Vec<usize>) {
        self.layers[rank] = order;
        self.reindex(rank);
    }

    /// The in-rank position of a link's end at `node`: its index, moved by the port offset as a share of its breadth.
    pub(crate) fn slot(&self, node: usize, offset: f64) -> f64 {
        let breadth = self.graph.nodes[node].breadth.max(1.0);
        as_f64(self.index[node]) + (offset / breadth) * PORT_SHARE
    }

    fn reindex(&mut self, rank: usize) {
        for (k, &x) in self.layers[rank].iter().enumerate() {
            self.index[x] = k;
        }
    }
}

/// The units of a layer, left to right: each block's members in their order, and every other node alone. The ordering
/// moves units, never the members of a block apart, so a node and its lateral port dummies stay together.
pub(crate) fn units_of(layer: &[usize], block: &[usize]) -> Vec<Vec<usize>> {
    let mut units: Vec<Vec<usize>> = Vec::new();
    for &x in layer {
        match units.last_mut() {
            Some(last) if block[last[0]] == block[x] => last.push(x),
            _ => units.push(vec![x]),
        }
    }
    units
}

/// A count as a float. Layouts are far below 2^32 nodes, so this is exact.
pub(crate) fn as_f64(n: usize) -> f64 {
    f64::from(u32::try_from(n).expect("layout counts fit in u32"))
}

/// Ascending, with equal values (including `-0.0` and `0.0`) tied, as TypeScript's `a - b` compares them.
pub(crate) fn ascending(a: f64, b: f64) -> Ordering {
    a.partial_cmp(&b).unwrap_or(Ordering::Equal)
}
