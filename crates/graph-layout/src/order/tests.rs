//! Tests of the order model and the crossing count on small graphs whose crossings are known by hand. The TypeScript
//! comparison is in `order_checks`.

use super::crossings::count_crossings;
use super::{OrderModel, exact_minimum_crossings, total_crossings, units_of};
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
                    weight,
                    top_offset,
                    bottom_offset,
                },
            )
            .collect(),
        block: (0..upper + lower).collect(),
        paths: vec![Vec::new(); upper + lower],
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
