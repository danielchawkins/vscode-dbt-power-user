//! Tests of the order model and the crossing count on small graphs whose crossings are known by hand. The TypeScript
//! comparison is in `order_checks`.

use super::clusters::{gather_clusters, legal_slots};
use super::crossings::count_crossings;
use super::{Hints, OrderModel, exact_minimum_crossings, order, total_crossings, units_of};
use crate::budget::Budget;
use crate::layering::{LayeredGraph, LayeredNode, Segment};

/// Two ranks of nodes `0..n_upper` and `n_upper..`, with the given segments (top, bottom, weight, offsets).
fn two_ranks(
    upper: usize,
    lower: usize,
    segments: &[(usize, usize, f64, f64, f64)],
) -> LayeredGraph {
    let nodes = (0..upper + lower)
        .map(|x| LayeredNode {
            id: Some(x),
            rank: usize::from(x >= upper),
            breadth: 1.0,
            port: None,
        })
        .collect();
    LayeredGraph {
        nodes,
        segments: segments
            .iter()
            .map(
                |&(top, bottom, weight, top_offset, bottom_offset)| Segment {
                    top,
                    bottom,
                    bundle: 0,
                    weight,
                    top_offset,
                    bottom_offset,
                },
            )
            .collect(),
        block: (0..upper + lower).collect(),
        paths: vec![Vec::new(); upper + lower],
        spines: Vec::new(),
        ranks: 2,
    }
}

#[test]
fn units_keep_each_block_together_and_alone_nodes_apart() {
    let block = [0, 0, 2, 3, 3, 5];
    assert_eq!(
        units_of(&[0, 1, 2, 3, 4, 5], &block),
        vec![vec![0, 1], vec![2], vec![3, 4], vec![5]]
    );
    assert_eq!(units_of(&[], &block), Vec::<Vec<usize>>::new());
}

#[test]
fn two_crossing_links_count_the_product_of_their_weights() {
    // Upper 0 before upper 1, but lower 0 is before lower 1 as well: the links cross once per weight pair.
    assert_eq!(count_crossings(&[(0.0, 1.0, 1.0), (1.0, 0.0, 2.0)]), 2.0);
    assert_eq!(count_crossings(&[(0.0, 1.0, 0.5), (1.0, 0.0, 2.0)]), 1.0);
}

#[test]
fn links_that_share_a_position_do_not_cross() {
    assert_eq!(count_crossings(&[(0.0, 0.0, 1.0), (0.0, 1.0, 1.0)]), 0.0);
    assert_eq!(count_crossings(&[(0.0, 1.0, 1.0), (1.0, 1.0, 3.0)]), 0.0);
    assert_eq!(count_crossings(&[]), 0.0);
}

#[test]
fn the_total_counts_each_pair_of_adjacent_ranks_once() {
    // Upper 0 -> lower 1 and upper 1 -> lower 0: one crossing of weight 1 * 1.
    let graph = two_ranks(2, 2, &[(0, 3, 1.0, 0.0, 0.0), (1, 2, 1.0, 0.0, 0.0)]);
    let model = OrderModel::new(&graph, vec![vec![0, 1], vec![2, 3]]);
    assert_eq!(total_crossings(&model), 1.0);
    let swapped = OrderModel::new(&graph, vec![vec![1, 0], vec![2, 3]]);
    assert_eq!(total_crossings(&swapped), 0.0);
}

#[test]
fn a_port_offset_moves_a_link_past_its_neighbour() {
    // Node 0 has breadth 1, so an offset of 1.5 moves its upper end to 0 + 1.5 * 0.9 = 1.35, past node 1 at 1.0. The
    // two links then keep their order at the top and the crossing goes.
    let graph = two_ranks(2, 2, &[(0, 3, 1.0, 0.0, 0.0), (1, 2, 1.0, 0.0, 0.0)]);
    let model = OrderModel::new(&graph, vec![vec![0, 1], vec![2, 3]]);
    assert_eq!(total_crossings(&model), 1.0);
    let moved = two_ranks(2, 2, &[(0, 3, 1.0, 1.5, 0.0), (1, 2, 1.0, 0.0, 0.0)]);
    let model = OrderModel::new(&moved, vec![vec![0, 1], vec![2, 3]]);
    assert!((model.slot(0, 1.5) - 1.35).abs() < 1e-12);
    assert_eq!(total_crossings(&model), 0.0);
}

#[test]
fn the_exact_search_finds_the_order_without_crossings() {
    let graph = two_ranks(2, 2, &[(0, 3, 1.0, 0.0, 0.0), (1, 2, 1.0, 0.0, 0.0)]);
    let best = exact_minimum_crossings(&graph, &[vec![0, 1], vec![2, 3]]).expect("four orders fit");
    assert_eq!(best.crossings, 0.0);
    assert_eq!(best.layers, vec![vec![0, 1], vec![3, 2]]);
}

/// Real nodes 0 and 2 on rank 0, real node 1 on rank 2, and a dummy (index 3) on rank 1 that carries 0 to 1. Node 4
/// (id 3) sits on rank 1 with no links. Node 2 links straight to 1.
fn dummy_graph() -> LayeredGraph {
    let rank_of = [0, 2, 0, 1, 1];
    let nodes = rank_of
        .iter()
        .enumerate()
        .map(|(x, &rank)| LayeredNode {
            id: (x != 3).then_some(x),
            rank,
            breadth: if x == 3 { 4.0 } else { 1.0 },
            port: None,
        })
        .collect();
    let segment = |top, bottom| Segment {
        top,
        bottom,
        bundle: 0,
        weight: 1.0,
        top_offset: 0.0,
        bottom_offset: 0.0,
    };
    LayeredGraph {
        nodes,
        segments: vec![segment(0, 3), segment(3, 1), segment(2, 1)],
        block: (0..5).collect(),
        paths: vec![Vec::new(); 5],
        spines: Vec::new(),
        ranks: 3,
    }
}

#[test]
fn hinted_order_keeps_every_node_and_dummy_and_is_deterministic() {
    let graph = dummy_graph();
    let hints: Hints = [(0, 1.0), (1, 2.0), (2, 0.0), (3, 0.0)]
        .into_iter()
        .collect();
    let budget = Budget::for_effort(Some("balanced")).expect("balanced exists");
    let first = order(&graph, Some(&hints), &budget, 5);
    assert_eq!(first, order(&graph, Some(&hints), &budget, 5));
    let mut all = first.layers.concat();
    all.sort_unstable();
    assert_eq!(all, vec![0, 1, 2, 3, 4], "every node once");
    let mut rank1 = first.layers[1].clone();
    rank1.sort_unstable();
    assert_eq!(rank1, vec![3, 4], "the dummy stays on its rank");
    let model = OrderModel::new(&graph, first.layers.clone());
    assert_eq!(first.crossings, total_crossings(&model));
}

/// Rank 0: nodes 0 and 2 in cluster 0, node 1 outside. Rank 1: nodes 3 and 5 in cluster 0, node 4 outside. The links
/// cross, so the search has work to do.
fn clustered_graph() -> LayeredGraph {
    let rank_of = [0, 0, 0, 1, 1, 1];
    let nodes = rank_of
        .iter()
        .enumerate()
        .map(|(x, &rank)| LayeredNode {
            id: Some(x),
            rank,
            breadth: 1.0,
            port: None,
        })
        .collect();
    let segments = [(0, 3), (1, 4), (2, 5), (0, 5), (2, 3)]
        .iter()
        .map(|&(top, bottom)| Segment {
            top,
            bottom,
            bundle: 0,
            weight: 1.0,
            top_offset: 0.0,
            bottom_offset: 0.0,
        })
        .collect();
    LayeredGraph {
        nodes,
        segments,
        block: (0..6).collect(),
        paths: vec![vec![0], Vec::new(), vec![0], vec![0], Vec::new(), vec![0]],
        spines: Vec::new(),
        ranks: 2,
    }
}

/// Whether the members of a cluster are one unbroken run in `layer`.
fn contiguous(layer: &[usize], members: &[usize]) -> bool {
    let at: Vec<usize> = layer
        .iter()
        .enumerate()
        .filter(|(_, x)| members.contains(x))
        .map(|(i, _)| i)
        .collect();
    at.windows(2).all(|w| w[1] == w[0] + 1)
}

#[test]
fn gather_clusters_puts_each_cluster_in_one_run() {
    let graph = clustered_graph();
    let mut model = OrderModel::new(&graph, vec![vec![0, 1, 2], vec![3, 4, 5]]);
    gather_clusters(&mut model);
    assert!(
        contiguous(&model.layers[0], &[0, 2]),
        "{:?}",
        model.layers[0]
    );
    assert!(
        contiguous(&model.layers[1], &[3, 5]),
        "{:?}",
        model.layers[1]
    );
    let mut rank0 = model.layers[0].clone();
    rank0.sort_unstable();
    assert_eq!(rank0, vec![0, 1, 2], "gathering keeps every node");
}

#[test]
fn legal_slots_pass_siblings_only_where_chains_allow() {
    // Chains [0] and [1] are siblings: passing one flips their order. Two units of cluster 0 are not siblings.
    let own: &[usize] = &[0];
    let same: &[usize] = &[0];
    let other: &[usize] = &[1];
    assert_eq!(
        legal_slots(own, &[&[0], &[1], &[0]], 0),
        vec![true, true, false, false]
    );
    assert_eq!(legal_slots(own, &[same, same], 1), vec![true, true, true]);
    assert_eq!(legal_slots(own, &[other], 0), vec![true, false]);
}

#[test]
fn ordering_keeps_clusters_in_one_run_on_a_clustered_graph() {
    let graph = clustered_graph();
    let budget = Budget::for_effort(Some("balanced")).expect("balanced exists");
    for seed in 0..5 {
        let result = order(&graph, None, &budget, seed);
        assert!(
            contiguous(&result.layers[0], &[0, 2]),
            "seed {seed}: {:?}",
            result.layers
        );
        assert!(
            contiguous(&result.layers[1], &[3, 5]),
            "seed {seed}: {:?}",
            result.layers
        );
        assert_eq!(
            result.crossings,
            total_crossings(&OrderModel::new(&graph, result.layers.clone()))
        );
    }
}
