//! The in-rank problem of an ordering, a port of `packages/graph-layout/src/place/links.ts` (`problemOf`). The layered
//! graph is stated in plain data, since `place` does not read `layering` or `order` (ADR 0011, module table): the caller
//! gives each layered node, each segment and each cluster spine, and the problem follows from them.

use super::gaps::{GapNode, gaps_left};
use super::hints::{Hint, hint_corner};
use super::problem::{Link, Problem, Pull};

/// Link weight factor by the number of dummy ends: real-real, real-dummy and dummy-dummy.
const DUMMY_FACTOR: [f64; 3] = [1.0, 2.0, 8.0];

/// Pull weight that holds the anchor at the origin before the translation that makes it exact.
const ANCHOR_WEIGHT: f64 = 100.0;

/// Weight of a cluster spine's link before the dummy factor: it keeps a spine straight without moving its members much.
const SPINE_WEIGHT: f64 = 1.0;

/// One layered node: its id (`None` for a dummy), its breadth, block and anchoring for the gaps, and its hint.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct LayeredNode<'a> {
    pub(crate) id: Option<&'a str>,
    pub(crate) breadth: f64,
    pub(crate) block: usize,
    pub(crate) anchored: bool,
    pub(crate) hint: Option<Hint>,
}

/// A segment between two layered nodes of adjacent ranks, before its weight is scaled for dummies.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Segment {
    pub(crate) top: usize,
    pub(crate) bottom: usize,
    pub(crate) weight: f64,
    pub(crate) top_offset: f64,
    pub(crate) bottom_offset: f64,
    /// Whether the segment's bundle is directed across the ranks (`directedBundles`): only `levels` reads it, and the
    /// caller states it, since `place` reads no graph.
    pub(crate) directed: bool,
}

/// The layered graph of an ordering: its ranks in order, its nodes, segments and cluster spines.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Layered<'a> {
    pub(crate) layers: &'a [Vec<usize>],
    pub(crate) nodes: &'a [LayeredNode<'a>],
    pub(crate) segments: &'a [Segment],
    pub(crate) spines: &'a [Vec<usize>],
}

/// The options the problem reads: the anchor's id, the pull stability, the direction, and the node and edge spacing.
#[derive(Debug, Clone, Copy)]
pub(crate) struct LinkOptions<'a> {
    pub(crate) anchor: Option<&'a str>,
    pub(crate) stability: f64,
    pub(crate) down: bool,
    pub(crate) spacing_node: f64,
    pub(crate) spacing_edge: f64,
}

/// The problem of an ordering: the rank chains, the links of its segments and spines, and the pulls of its hints.
pub(crate) fn problem_of(layered: &Layered<'_>, options: &LinkOptions<'_>) -> Problem {
    let dummy: Vec<bool> = layered.nodes.iter().map(|n| n.id.is_none()).collect();
    let gap_nodes: Vec<GapNode> = layered
        .nodes
        .iter()
        .map(|n| GapNode {
            breadth: n.breadth,
            block: n.block,
            anchored: n.anchored,
        })
        .collect();
    let mut links: Vec<Link> = layered
        .segments
        .iter()
        .map(|s| Link {
            top: s.top,
            bottom: s.bottom,
            weight: s.weight * DUMMY_FACTOR[dummy_ends(&dummy, s.top, s.bottom)],
            top_offset: s.top_offset,
            bottom_offset: s.bottom_offset,
        })
        .collect();
    links.extend(spine_links(layered.spines, &dummy));
    Problem {
        layers: layered.layers.to_vec(),
        gap_left: gaps_left(
            layered.layers,
            &gap_nodes,
            options.spacing_node,
            options.spacing_edge,
        ),
        dummy,
        links,
        pulls: pulls_of(layered.nodes, options),
        extra: None,
    }
}

/// How many of the two ends of a link are dummies.
fn dummy_ends(dummy: &[bool], top: usize, bottom: usize) -> usize {
    usize::from(dummy[top]) + usize::from(dummy[bottom])
}

/// One link between each two consecutive nodes of every cluster spine, weighted as the dummies at its ends.
fn spine_links(spines: &[Vec<usize>], dummy: &[bool]) -> Vec<Link> {
    spines
        .iter()
        .flat_map(|run| {
            run.windows(2).map(|pair| {
                let (top, bottom) = (pair[0], pair[1]);
                Link {
                    top,
                    bottom,
                    weight: SPINE_WEIGHT * DUMMY_FACTOR[dummy_ends(dummy, top, bottom)],
                    top_offset: 0.0,
                    bottom_offset: 0.0,
                }
            })
        })
        .collect()
}

/// The pulls: the anchor is held at zero; each hinted real node is drawn to its previous in-rank centre, weighted by
/// `stability`. A hint gives the top-left corner, so the centre adds half the node's breadth.
fn pulls_of(nodes: &[LayeredNode<'_>], options: &LinkOptions<'_>) -> Vec<Pull> {
    let mut pulls = Vec::new();
    for (i, node) in nodes.iter().enumerate() {
        let Some(id) = node.id else {
            continue;
        };
        if options.anchor == Some(id) {
            pulls.push(Pull {
                node: i,
                weight: ANCHOR_WEIGHT,
                target: 0.0,
            });
            continue;
        }
        if let Some(hint) = node.hint
            && options.stability > 0.0
        {
            pulls.push(Pull {
                node: i,
                weight: options.stability,
                target: hint_corner(hint, options.down, true) + node.breadth / 2.0,
            });
        }
    }
    pulls
}

#[cfg(test)]
mod tests {
    use super::{Layered, LayeredNode, LinkOptions, Segment, problem_of};
    use crate::place::hints::Hint;

    fn node(id: Option<&str>, breadth: f64, hint: Option<Hint>) -> LayeredNode<'_> {
        LayeredNode {
            id,
            breadth,
            block: 0,
            anchored: true,
            hint,
        }
    }

    fn options(anchor: Option<&str>) -> LinkOptions<'_> {
        LinkOptions {
            anchor,
            stability: 0.5,
            down: true,
            spacing_node: 1.0,
            spacing_edge: 1.0,
        }
    }

    #[test]
    fn segments_and_spines_are_weighted_by_their_dummy_ends() {
        let nodes = [
            node(Some("a"), 2.0, None),
            node(None, 1.0, None),
            node(None, 1.0, None),
        ];
        let layers = [vec![0], vec![1], vec![2]];
        let segments = [
            Segment {
                top: 0,
                bottom: 1,
                weight: 1.0,
                top_offset: 0.5,
                bottom_offset: -0.5,
                directed: false,
            },
            Segment {
                top: 1,
                bottom: 2,
                weight: 1.0,
                top_offset: 0.0,
                bottom_offset: 0.0,
                directed: false,
            },
        ];
        let spines = [vec![0, 1, 2]];
        let layered = Layered {
            layers: &layers,
            nodes: &nodes,
            segments: &segments,
            spines: &spines,
        };
        let problem = problem_of(&layered, &options(None));
        let weights: Vec<f64> = problem.links.iter().map(|l| l.weight).collect();
        assert_eq!(weights, [2.0, 8.0, 2.0, 8.0]);
        assert_eq!(problem.links[0].top_offset, 0.5);
        assert_eq!(problem.links[0].bottom_offset, -0.5);
        assert_eq!(problem.dummy, [false, true, true]);
        assert_eq!(problem.layers, layers);
    }

    #[test]
    fn the_anchor_is_pulled_to_the_origin_and_hints_to_their_centres() {
        let hint = Hint { x: 10.0, y: 4.0 };
        let nodes = [
            node(Some("a"), 2.0, None),
            node(Some("b"), 4.0, Some(hint)),
            node(Some("c"), 2.0, Some(hint)),
        ];
        let layers = [vec![0, 1, 2]];
        let layered = Layered {
            layers: &layers,
            nodes: &nodes,
            segments: &[],
            spines: &[],
        };
        let problem = problem_of(&layered, &options(Some("a")));
        let pulls: Vec<(usize, f64, f64)> = problem
            .pulls
            .iter()
            .map(|p| (p.node, p.weight, p.target))
            .collect();
        assert_eq!(pulls, [(0, 100.0, 0.0), (1, 0.5, 12.0), (2, 0.5, 11.0)]);
    }

    #[test]
    fn a_zero_stability_drops_the_hint_pulls() {
        let hint = Hint { x: 1.0, y: 1.0 };
        let nodes = [node(Some("b"), 2.0, Some(hint))];
        let layers = [vec![0]];
        let layered = Layered {
            layers: &layers,
            nodes: &nodes,
            segments: &[],
            spines: &[],
        };
        let mut options = options(None);
        options.stability = 0.0;
        assert_eq!(problem_of(&layered, &options).pulls.len(), 0);
    }
}
