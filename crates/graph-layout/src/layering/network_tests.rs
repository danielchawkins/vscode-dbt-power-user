//! Tests of network simplex, the spanning tree and the rank constraints, ported from `rank/networkSimplex.test.ts`,
//! `rank/spanningTree.test.ts` and `rank/constraints.test.ts`. The properties are proptest properties; their failing
//! seeds are committed under `proptest-regressions/`.

use proptest::prelude::*;

use super::constraints::{hint_constraints, partition_constraints};
use super::network::{NetworkEdge, network_simplex};
use super::tree::{SpanningTree, feasible_tree};
use super::{PartitionMode, RankError};

const MAX_ITERATIONS: usize = 10_000;

/// A node number as a float rank. Test sizes are far below 2^32.
fn f(n: usize) -> f64 {
    f64::from(u32::try_from(n).expect("test sizes fit in u32"))
}

fn edge(tail: usize, head: usize, min_length: f64, weight: f64) -> NetworkEdge {
    NetworkEdge {
        tail,
        head,
        min_length,
        weight,
    }
}

fn weighted_length(ranks: &[f64], edges: &[NetworkEdge]) -> f64 {
    edges.iter().fold(0.0, |sum, e| {
        sum + e.weight * (ranks[e.head] - ranks[e.tail])
    })
}

fn meets_lengths(ranks: &[f64], edges: &[NetworkEdge]) -> bool {
    edges
        .iter()
        .all(|e| ranks[e.head] - ranks[e.tail] >= e.min_length)
}

/// The least weighted length over every ranking with values 0 to `top`, by depth-first search with pruning.
fn brute_force_optimum(count: usize, edges: &[NetworkEdge], top: usize) -> f64 {
    let mut finished_at: Vec<Vec<NetworkEdge>> = vec![Vec::new(); count];
    for e in edges {
        finished_at[e.tail.max(e.head)].push(*e);
    }
    let mut ranks = vec![0.0; count];
    let mut best = f64::INFINITY;
    place(0, count, top, edges, &finished_at, &mut ranks, &mut best);
    best
}

fn place(
    v: usize,
    count: usize,
    top: usize,
    edges: &[NetworkEdge],
    finished_at: &[Vec<NetworkEdge>],
    ranks: &mut [f64],
    best: &mut f64,
) {
    if v == count {
        *best = best.min(weighted_length(ranks, edges));
        return;
    }
    for r in 0..=top {
        ranks[v] = f(r);
        let ok = finished_at[v]
            .iter()
            .all(|e| ranks[e.head] - ranks[e.tail] >= e.min_length);
        if ok {
            place(v + 1, count, top, edges, finished_at, ranks, best);
        }
    }
}

/// Edges that run from the lower label to the higher, so the constraint graph has no cycle.
fn acyclic_edges(count: usize, raw: &[(usize, usize, usize, usize)]) -> Vec<NetworkEdge> {
    raw.iter()
        .filter(|&&(a, b, _, _)| count > 1 && a % count != b % count)
        .map(|&(a, b, min_length, weight)| {
            let (x, y) = (a % count, b % count);
            edge(x.min(y), x.max(y), f(min_length), f(weight))
        })
        .collect()
}

#[test]
fn an_edgeless_graph_ranks_its_nodes_at_zero() {
    assert_eq!(network_simplex(0, &[], MAX_ITERATIONS), Ok(vec![]));
    assert_eq!(network_simplex(1, &[], MAX_ITERATIONS), Ok(vec![0.0]));
}

#[test]
fn a_chain_is_one_rank_apart() {
    let edges = [edge(0, 1, 1.0, 1.0), edge(1, 2, 1.0, 1.0)];
    assert_eq!(
        network_simplex(3, &edges, MAX_ITERATIONS),
        Ok(vec![0.0, 1.0, 2.0])
    );
}

#[test]
fn parallel_edges_merge_with_weights_added_and_the_longest_minimum_kept() {
    let edges = [edge(0, 1, 1.0, 1.0), edge(0, 1, 3.0, 2.0)];
    assert_eq!(
        network_simplex(2, &edges, MAX_ITERATIONS),
        Ok(vec![0.0, 3.0])
    );
}

#[test]
fn separate_components_are_ranked_without_being_joined() {
    let ranks = network_simplex(3, &[edge(1, 2, 2.0, 1.0)], MAX_ITERATIONS)
        .expect("a single constraint ranks");
    assert_eq!(ranks[2] - ranks[1], 2.0);
    assert_eq!(ranks.iter().copied().fold(f64::INFINITY, f64::min), 0.0);
}

#[test]
fn a_cycle_is_refused() {
    let edges = [edge(0, 1, 1.0, 1.0), edge(1, 0, 1.0, 1.0)];
    assert_eq!(
        network_simplex(2, &edges, MAX_ITERATIONS),
        Err(RankError::Cycle)
    );
}

#[test]
fn the_iteration_cap_at_zero_still_gives_a_feasible_ranking() {
    let edges = [
        edge(0, 2, 1.0, 1.0),
        edge(1, 2, 2.0, 1.0),
        edge(2, 3, 1.0, 4.0),
    ];
    let ranks = network_simplex(4, &edges, 0).expect("feasible start ranks");
    assert!(meets_lengths(&ranks, &edges));
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(150))]
    #[test]
    fn the_ranking_matches_the_brute_force_optimum_on_small_dags(
        count in 2usize..=6,
        raw in prop::collection::vec((0usize..=20, 0usize..=20, 0usize..=1, 0usize..=3), 0..=9),
    ) {
        let edges = acyclic_edges(count, &raw);
        let ranks = network_simplex(count, &edges, MAX_ITERATIONS).expect("a DAG ranks");
        prop_assert!(meets_lengths(&ranks, &edges));
        prop_assert_eq!(ranks.iter().copied().fold(f64::INFINITY, f64::min).to_bits(), 0.0_f64.to_bits());
        let top = (count - 1).max(1);
        prop_assert_eq!(
            weighted_length(&ranks, &edges).to_bits(),
            brute_force_optimum(count, &edges, top).to_bits()
        );
    }
}

proptest! {
    #[test]
    fn the_ranking_is_deterministic(
        count in 1usize..=12,
        raw in prop::collection::vec((0usize..=20, 0usize..=20, 0usize..=1, 0usize..=3), 0..=30),
    ) {
        let edges = acyclic_edges(count, &raw);
        prop_assert_eq!(
            network_simplex(count, &edges, MAX_ITERATIONS),
            network_simplex(count, &edges, MAX_ITERATIONS)
        );
    }
}

/// A connected network on `count` nodes, acyclic by label and feasible at the labels: a chain of zero-weight edges
/// joins it, and each extra edge runs upward.
fn connected_network(count: usize, raw: &[(usize, usize, usize)]) -> Vec<NetworkEdge> {
    let mut edges: Vec<NetworkEdge> = (1..count).map(|v| edge(v - 1, v, 0.0, 0.0)).collect();
    for &(a, b, weight) in raw {
        let (x, y) = (a % count, b % count);
        if x != y {
            edges.push(edge(x.min(y), x.max(y), 1.0, f(weight)));
        }
    }
    edges
}

/// The non-tree edge a pivot on `leave` enters by: its tail below the leaving edge, its head above, least index.
fn entering_for(tree: &SpanningTree<'_>, edges: &[NetworkEdge], leave: usize) -> Option<usize> {
    let child = tree.child_of(leave);
    let head_is_child = child == edges[leave].head;
    edges.iter().enumerate().find_map(|(ei, x)| {
        if tree.is_tree(ei) {
            return None;
        }
        let tail_below = tree.in_subtree(child, x.tail) == head_is_child;
        let head_below = tree.in_subtree(child, x.head) == head_is_child;
        (tail_below && !head_below).then_some(ei)
    })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(200))]
    #[test]
    fn incremental_cut_values_match_a_fresh_computation_across_exchanges(
        count in 2usize..=9,
        raw in prop::collection::vec((0usize..=30, 0usize..=30, 0usize..=3), 0..=24),
        picks in prop::collection::vec(0usize..=100, 0..=12),
    ) {
        let edges = connected_network(count, &raw);
        let mut ranks: Vec<f64> = (0..count).map(f).collect();
        let start = feasible_tree(count, &edges, &mut ranks).expect("connected network");
        let mut tree = SpanningTree::new(count, &edges, &start);
        for pick in picks {
            let list = tree.tree_edges().to_vec();
            let leave = list[pick % list.len()];
            let Some(enter) = entering_for(&tree, &edges, leave) else {
                continue;
            };
            tree.exchange(leave, enter);
            let fresh = SpanningTree::new(count, &edges, tree.tree_edges());
            for &f_edge in tree.tree_edges() {
                // Adding zero turns a negative zero into zero, so the comparison is on values alone.
                prop_assert_eq!((tree.cut(f_edge) + 0.0).to_bits(), (fresh.cut(f_edge) + 0.0).to_bits());
            }
        }
    }
}

#[test]
fn a_strict_band_sits_below_the_next_band() {
    let partitions = [Some(0.0), Some(1.0)];
    let ext = partition_constraints(&partitions, PartitionMode::Strict);
    assert_eq!(ext.count, 3, "two nodes and one gate");
    let ranks = network_simplex(ext.count, &ext.edges, MAX_ITERATIONS).expect("bands rank");
    assert!(ranks[1] > ranks[0]);
}

#[test]
fn a_soft_band_costs_its_hinge_and_the_band_stays_in_order_when_nothing_pulls_against_it() {
    let partitions = [Some(0.0), Some(1.0), None];
    let ext = partition_constraints(&partitions, PartitionMode::Soft);
    assert_eq!(ext.count, 5, "three nodes, one gate and one mediator");
    let ranks = network_simplex(ext.count, &ext.edges, MAX_ITERATIONS).expect("bands rank");
    assert!(ranks[1] - ranks[0] >= 1.0 - 1e-12);
}

#[test]
fn a_hint_does_not_break_a_ranking_edge_that_pulls_against_it() {
    // Node 0 is hinted to rank 5 and node 1 to rank 0, but the edge 0 -> 1 needs node 1 at least one rank above node 0.
    let hints = [Some(5), Some(0)];
    let ext = hint_constraints(2, &hints, 1.0);
    let mut edges = vec![edge(0, 1, 1.0, 1.0)];
    edges.extend(ext.edges);
    let ranks = network_simplex(ext.count, &edges, MAX_ITERATIONS).expect("hints rank");
    assert!(ranks[1] - ranks[0] >= 1.0);
}

#[test]
fn no_hints_add_no_nodes_and_no_edges() {
    let ext = hint_constraints(4, &[None, None], 1.0);
    assert_eq!(ext.count, 4);
    assert_eq!(ext.edges.len(), 0);
}
