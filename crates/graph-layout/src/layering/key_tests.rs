//! Dummy keys, ported from the three properties of `layeredKeys.test.ts`: every dummy has a key that its chain agrees
//! with, no two dummies share a key, and every key survives adding an unrelated edge. A key is the owner edge, the rank
//! and the position of a dummy (`DummyKey`). The properties are proptest properties; their failing seeds are committed
//! under `proptest-regressions/`.

use std::collections::BTreeSet;

use proptest::prelude::*;

use super::tests::{balanced, indexed, layering_rule, options};
use super::{ChainNode, EdgeRule, Layers, PartitionMode, Scratch, layer, rank};

/// A random graph of 2 to 14 nodes whose edges have the three kinds of the layering tests. Self-loops, parallel edges
/// and cycles are allowed, as in the TypeScript generator.
fn keyed_graph() -> impl Strategy<Value = (usize, Vec<(usize, usize, usize)>)> {
    (2usize..=14).prop_flat_map(|count| {
        (
            Just(count),
            prop::collection::vec((0..count, 0..count, 0usize..3), 0..=28),
        )
    })
}

/// The layers of a graph: its ranks come from the ranking, and the dummies from the layering.
fn layered(count: usize, edges: &[(usize, usize, usize)]) -> Layers {
    let rules: Vec<EdgeRule> = edges.iter().map(|&(_, _, k)| layering_rule(k)).collect();
    let pairs: Vec<(usize, usize)> = edges.iter().map(|&(a, b, _)| (a, b)).collect();
    let budget = balanced();
    let no_bands = vec![None; count];
    let graph = indexed(count, &pairs);
    let ranking = rank(
        &graph,
        &options(PartitionMode::Soft, &no_bands, &rules, &budget),
        &mut Scratch::default(),
    )
    .expect("the graph ranks");
    layer(&graph, &rules, &ranking.ranks)
}

/// The key of dummy `d` as comparable values: the owner edge, the rank's bits and the position.
fn key_of(layers: &Layers, d: usize) -> (usize, u64, usize) {
    let key = layers.dummies[d];
    (key.owner, key.rank.to_bits(), key.position)
}

/// The keys of every dummy, sorted, so two layerings compare as sets.
fn sorted_keys(layers: &Layers) -> Vec<(usize, u64, usize)> {
    let mut keys: Vec<_> = (0..layers.dummies.len())
        .map(|d| key_of(layers, d))
        .collect();
    keys.sort_unstable();
    keys
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(200))]

    #[test]
    fn every_dummy_has_a_key_that_its_chain_agrees_with(
        (count, edges) in keyed_graph(),
    ) {
        let layers = layered(count, &edges);
        let mut chain_uses = vec![0usize; layers.dummies.len()];
        for bundle in &layers.bundles {
            for (position, node) in bundle.chain.iter().enumerate() {
                if let ChainNode::Dummy(d) = *node {
                    chain_uses[d] += 1;
                    prop_assert_eq!(layers.dummies[d].owner, bundle.edges[0]);
                    prop_assert_eq!(layers.dummies[d].position, position);
                }
            }
        }
        prop_assert!(
            chain_uses.iter().all(|&n| n == 1),
            "every dummy sits on exactly one chain: {:?}",
            chain_uses
        );
    }

    #[test]
    fn no_two_dummies_share_a_key((count, edges) in keyed_graph()) {
        let layers = layered(count, &edges);
        let distinct: BTreeSet<_> = (0..layers.dummies.len())
            .map(|d| key_of(&layers, d))
            .collect();
        prop_assert_eq!(distinct.len(), layers.dummies.len());
    }

    #[test]
    fn every_key_survives_adding_an_unrelated_edge((count, edges) in keyed_graph()) {
        let before = layered(count, &edges);
        let mut extended = edges.clone();
        extended.push((count, count + 1, 0));
        let after = layered(count + 2, &extended);
        prop_assert_eq!(sorted_keys(&after), sorted_keys(&before));
    }
}
