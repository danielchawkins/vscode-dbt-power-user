//! Tests of cycle breaking, ranking and layering, ported from `acyclic.test.ts`, `rank/rank.test.ts` and `layering.test.ts`.
//! The properties are proptest properties; their failing seeds are committed under `proptest-regressions/`. The solver
//! itself is tested in `network_tests`.

use proptest::prelude::*;

use super::acyclic::reversed_arcs;
use super::{ChainNode, EdgeRule, Layers, PartitionMode, RankOptions, Ranks, layer, rank};
use crate::budget::Budget;
use crate::index::Indexed;

/// A node number as a float rank. Test sizes are far below 2^32.
fn f(n: usize) -> f64 {
    f64::from(u32::try_from(n).expect("test sizes fit in u32"))
}

/// The rule of an edge of `kind` in the ranking tests: light, medium and heavy rank with weights 1, 2 and 3;
/// stretched ranks with a minimum length of 2; info does not rank.
fn ranking_rule(kind: usize) -> EdgeRule {
    let (ranks, min_length, weight) = match kind {
        0 => (true, 1.0, 1.0),
        1 => (true, 1.0, 2.0),
        2 => (true, 1.0, 3.0),
        3 => (true, 2.0, 1.0),
        _ => (false, 1.0, 1.0),
    };
    EdgeRule {
        kind,
        ranks,
        min_length,
        weight,
    }
}

/// The rule of an edge of `kind` in the layering tests: dependency and heavy rank (weights 1 and 4); column does not.
fn layering_rule(kind: usize) -> EdgeRule {
    let (ranks, weight) = match kind {
        0 => (true, 1.0),
        1 => (true, 4.0),
        _ => (false, 0.5),
    };
    EdgeRule {
        kind,
        ranks,
        min_length: 1.0,
        weight,
    }
}

/// The view of a graph of `count` nodes whose edges run between the given ends.
fn indexed(count: usize, pairs: &[(usize, usize)]) -> Indexed {
    let ends = pairs
        .iter()
        .map(|&(a, b)| {
            Some((
                u32::try_from(a).expect("small"),
                u32::try_from(b).expect("small"),
            ))
        })
        .collect();
    Indexed::from_ends(count, ends, &vec![true; pairs.len()])
}

fn balanced() -> Budget {
    Budget::for_effort(None).expect("the balanced budget exists")
}

fn options<'a>(
    partitions: PartitionMode,
    node_partition: &'a [Option<f64>],
    rules: &'a [EdgeRule],
    budget: &'a Budget,
) -> RankOptions<'a> {
    RankOptions {
        partitions,
        node_partition,
        edges: rules,
        hints: &[],
        stability: 1.0,
        budget,
    }
}

/// The weighted length of the ranking edges as laid out: each runs from its `from` rank to its `to` rank, after any
/// reversal.
fn weighted_length(pairs: &[(usize, usize)], rules: &[EdgeRule], result: &Ranks) -> f64 {
    let mut sum = 0.0;
    for (i, (&(s, t), rule)) in pairs.iter().zip(rules).enumerate() {
        if !rule.ranks || s == t {
            continue;
        }
        let (from, to) = if result.reversed.contains(&i) {
            (t, s)
        } else {
            (s, t)
        };
        sum += rule.weight * (result.ranks[to] - result.ranks[from]);
    }
    sum
}

/// The least total weighted length over rankings with every rank in 0 to `count - 1`, by branch and bound. A node with
/// no arc sits at 0, which costs nothing and keeps the search small.
fn brute_force_optimum(count: usize, arcs: &[(usize, usize, f64)]) -> f64 {
    let mut touched = vec![false; count];
    for &(from, to, _) in arcs {
        touched[from] = true;
        touched[to] = true;
    }
    let mut ranks = vec![0.0; count];
    let mut best = f64::INFINITY;
    search(0, count, &touched, arcs, &mut ranks, 0.0, &mut best);
    best
}

fn search(
    v: usize,
    count: usize,
    touched: &[bool],
    arcs: &[(usize, usize, f64)],
    ranks: &mut [f64],
    cost: f64,
    best: &mut f64,
) {
    if cost >= *best {
        return;
    }
    if v == count {
        *best = cost;
        return;
    }
    let top = if touched[v] { count - 1 } else { 0 };
    for r in 0..=top {
        ranks[v] = f(r);
        let mut added = 0.0;
        let mut ok = true;
        for &(from, to, weight) in arcs {
            if to != v {
                continue;
            }
            let span = ranks[to] - ranks[from];
            if span < 1.0 {
                ok = false;
                break;
            }
            added += weight * span;
        }
        if ok {
            search(v + 1, count, touched, arcs, ranks, cost + added, best);
        }
    }
}

/// Kahn's algorithm: true when the arcs over `count` nodes have no cycle.
fn is_acyclic(count: usize, arcs: &[(usize, usize)]) -> bool {
    let mut indegree = vec![0usize; count];
    for &(_, to) in arcs {
        indegree[to] += 1;
    }
    let mut queue: Vec<usize> = (0..count).filter(|&v| indegree[v] == 0).collect();
    let mut removed = 0;
    while let Some(v) = queue.pop() {
        removed += 1;
        for &(from, to) in arcs {
            if from == v {
                indegree[to] -= 1;
                if indegree[to] == 0 {
                    queue.push(to);
                }
            }
        }
    }
    removed == count
}

#[test]
fn acyclic_arcs_are_reversed_by_none() {
    assert_eq!(
        reversed_arcs(&[(0, 1), (1, 2), (0, 2)]),
        Vec::<usize>::new()
    );
}

#[test]
fn one_arc_of_a_two_cycle_is_reversed() {
    assert_eq!(reversed_arcs(&[(0, 1), (1, 0)]).len(), 1);
}

#[test]
fn a_triangle_is_broken_by_one_reversal() {
    let arcs = [(0, 1), (1, 2), (2, 0)];
    let reversed = reversed_arcs(&arcs);
    assert_eq!(reversed.len(), 1);
    let rest: Vec<(usize, usize)> = arcs
        .iter()
        .enumerate()
        .filter(|(i, _)| !reversed.contains(i))
        .map(|(_, &arc)| arc)
        .collect();
    assert!(is_acyclic(3, &rest));
}

#[test]
fn a_self_loop_is_never_reported() {
    assert_eq!(reversed_arcs(&[(0, 0), (0, 1)]), Vec::<usize>::new());
}

#[test]
fn of_two_opposing_arcs_the_first_listed_is_reversed() {
    // `first` is b -> a, then a -> b twice: the greedy order puts a first, so the arc listed first is the one reversed.
    assert_eq!(reversed_arcs(&[(1, 0), (0, 1), (0, 1)]), vec![0]);
}

#[test]
fn the_reversal_is_a_pure_function_of_its_input() {
    let arcs = [(3, 9), (9, 4), (4, 3), (4, 7)];
    assert_eq!(reversed_arcs(&arcs), reversed_arcs(&arcs));
}

/// The number of nodes and arcs of a random graph, arcs by node number.
fn random_arcs() -> impl Strategy<Value = (usize, Vec<(usize, usize)>)> {
    (1usize..=8).prop_flat_map(|count| {
        (
            Just(count),
            prop::collection::vec((0..count, 0..count), 0..=14),
        )
    })
}

proptest! {
    #[test]
    fn removing_the_reversed_arcs_leaves_an_acyclic_graph((count, arcs) in random_arcs()) {
        let reversed = reversed_arcs(&arcs);
        prop_assert!(reversed.iter().all(|&i| i < arcs.len()));
        let mut unique = reversed.clone();
        unique.dedup();
        prop_assert_eq!(unique.len(), reversed.len());
        // Self-loops are never reversed and sit outside the ordering, so the check leaves them out.
        let rest: Vec<(usize, usize)> = arcs
            .iter()
            .enumerate()
            .filter(|(i, arc)| !reversed.contains(i) && arc.0 != arc.1)
            .map(|(_, &arc)| arc)
            .collect();
        prop_assert!(is_acyclic(count, &rest));
    }
}

/// A random graph of `count` nodes, its edges as (source, target, kind), and the band of each node.
#[derive(Debug, Clone)]
struct Case {
    count: usize,
    edges: Vec<(usize, usize, usize)>,
    bands: Vec<Option<f64>>,
}

fn case() -> impl Strategy<Value = Case> {
    (1usize..=8).prop_flat_map(|count| {
        (
            Just(count),
            prop::collection::vec((0..count, 0..count, 0usize..5), 0..=12),
            prop::collection::vec(prop::option::weighted(0.8, 0u8..=2), count),
        )
            .prop_map(|(count, edges, bands)| Case {
                count,
                edges,
                bands: bands.into_iter().map(|b| b.map(f64::from)).collect(),
            })
    })
}

fn mode() -> impl Strategy<Value = PartitionMode> {
    prop_oneof![
        Just(PartitionMode::None),
        Just(PartitionMode::Soft),
        Just(PartitionMode::Strict),
    ]
}

/// Only edges that point from a lower index to a higher one, of the three ranking kinds, so the graph has no cycle.
fn dag_of(edges: &[(usize, usize, usize)]) -> Vec<(usize, usize, usize)> {
    edges
        .iter()
        .filter(|(a, b, _)| a != b)
        .map(|&(a, b, k)| (a.min(b), a.max(b), k % 3))
        .collect()
}

fn pairs_of(edges: &[(usize, usize, usize)]) -> Vec<(usize, usize)> {
    edges.iter().map(|&(a, b, _)| (a, b)).collect()
}

fn rules_of(edges: &[(usize, usize, usize)]) -> Vec<EdgeRule> {
    edges.iter().map(|&(_, _, k)| ranking_rule(k)).collect()
}

/// The band of each node as ranking reads it: an absent band counts as 0 under strict partitions only, and the caller
/// passes `None` for a free node.
fn strict_bands(bands: &[Option<f64>]) -> Vec<Option<f64>> {
    bands.iter().map(|b| Some(b.unwrap_or(0.0))).collect()
}

/// The whole number of a rank, which the ranking produces as an integer.
fn whole(rank: f64) -> u32 {
    (0u32..=10_000)
        .find(|&k| f64::from(k).to_bits() == rank.to_bits())
        .expect("a rank is a whole number below 10,000")
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(2000))]

    #[test]
    fn the_ranking_matches_the_brute_force_optimum_on_dags_of_up_to_8_nodes(c in case()) {
        let edges = dag_of(&c.edges);
        let rules = rules_of(&edges);
        let budget = balanced();
        let no_bands = vec![None; c.count];
        let graph = indexed(c.count, &pairs_of(&edges));
        let result = rank(&graph, &options(PartitionMode::None, &no_bands, &rules, &budget))
            .expect("a DAG ranks");
        let arcs: Vec<(usize, usize, f64)> = edges
            .iter()
            .zip(&rules)
            .map(|(&(a, b, _), rule)| (a, b, rule.weight))
            .collect();
        prop_assert_eq!(
            weighted_length(&pairs_of(&edges), &rules, &result).to_bits(),
            brute_force_optimum(c.count, &arcs).to_bits()
        );
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(120))]

    #[test]
    fn every_ranking_edge_spans_its_minimum_length_in_every_partition_mode(c in case(), m in mode()) {
        let rules = rules_of(&c.edges);
        let budget = balanced();
        let graph = indexed(c.count, &pairs_of(&c.edges));
        let result = rank(&graph, &options(m, &c.bands, &rules, &budget)).expect("ranks");
        for (i, (&(s, t), rule)) in pairs_of(&c.edges).iter().zip(&rules).enumerate() {
            if !rule.ranks || s == t {
                continue;
            }
            let (from, to) = if result.reversed.contains(&i) { (t, s) } else { (s, t) };
            prop_assert!(result.ranks[to] - result.ranks[from] >= rule.min_length);
        }
    }

    #[test]
    fn lower_strict_partitions_sit_in_earlier_ranks(c in case()) {
        let rules = rules_of(&c.edges);
        let budget = balanced();
        let bands = strict_bands(&c.bands);
        let graph = indexed(c.count, &pairs_of(&c.edges));
        let result = rank(&graph, &options(PartitionMode::Strict, &bands, &rules, &budget))
            .expect("ranks");
        for u in 0..c.count {
            for v in 0..c.count {
                if bands[u] < bands[v] {
                    prop_assert!(result.ranks[u] < result.ranks[v]);
                }
            }
        }
    }

    #[test]
    fn the_same_input_gives_the_same_ranks_and_reversed_edges(c in case(), m in mode()) {
        let rules = rules_of(&c.edges);
        let budget = balanced();
        let graph = indexed(c.count, &pairs_of(&c.edges));
        let opts = options(m, &c.bands, &rules, &budget);
        let first = rank(&graph, &opts).expect("ranks");
        let second = rank(&graph, &opts).expect("ranks");
        prop_assert_eq!(first, second);
    }

    #[test]
    fn edges_of_kinds_that_do_not_rank_leave_the_ranks_alone(c in case(), m in mode()) {
        let budget = balanced();
        let with_info = indexed(c.count, &pairs_of(&c.edges));
        let info_rules = rules_of(&c.edges);
        let all = rank(&with_info, &options(m, &c.bands, &info_rules, &budget)).expect("ranks");
        let kept: Vec<(usize, usize, usize)> = c.edges.iter().copied().filter(|&(_, _, k)| k != 4).collect();
        let ranking_only = indexed(c.count, &pairs_of(&kept));
        let rules = rules_of(&kept);
        let only = rank(&ranking_only, &options(m, &c.bands, &rules, &budget)).expect("ranks");
        prop_assert_eq!(all.ranks, only.ranks);
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(80))]

    #[test]
    fn existing_nodes_keep_their_ranks_when_a_sink_joins_under_hints(c in case()) {
        let edges = dag_of(&c.edges);
        let rules = rules_of(&edges);
        let budget = balanced();
        let no_bands = vec![None; c.count];
        let graph = indexed(c.count, &pairs_of(&edges));
        let before = rank(&graph, &options(PartitionMode::None, &no_bands, &rules, &budget))
            .expect("ranks");
        let mut hints: Vec<Option<u32>> = before.ranks.iter().map(|&r| Some(whole(r))).collect();
        hints.push(None);
        let mut grown_edges = edges.clone();
        grown_edges.push((0, c.count, 0));
        let grown_rules = rules_of(&grown_edges);
        let grown_bands = vec![None; c.count + 1];
        let grown = indexed(c.count + 1, &pairs_of(&grown_edges));
        let opts = RankOptions {
            hints: &hints,
            ..options(PartitionMode::None, &grown_bands, &grown_rules, &budget)
        };
        let after = rank(&grown, &opts).expect("ranks");
        prop_assert_eq!(&after.ranks[..c.count], &before.ranks[..]);
    }
}

#[test]
fn a_free_node_is_ranked_by_its_edges_alone_under_soft_partitions() {
    // Two band-2 nodes and one free node, with no edges. The free node puts no band above band 2, so all three share
    // rank 0. Counted as band 0, it would push both band-2 nodes a rank below it.
    let bands = [Some(2.0), Some(2.0), None];
    let budget = balanced();
    let graph = indexed(3, &[]);
    let result = rank(&graph, &options(PartitionMode::Soft, &bands, &[], &budget)).expect("ranks");
    assert_eq!(result.ranks, vec![0.0, 0.0, 0.0]);
}

/// A random graph of up to 8 nodes whose edges have the layering kinds, for the chain properties.
fn layering_case() -> impl Strategy<Value = (usize, Vec<(usize, usize, usize)>)> {
    (1usize..=8).prop_flat_map(|count| {
        (
            Just(count),
            prop::collection::vec((0..count, 0..count, 0usize..3), 0..=14),
        )
    })
}

fn chain_rank(layers: &Layers, ranks: &[f64], node: ChainNode) -> f64 {
    match node {
        ChainNode::Node(v) => ranks[v],
        ChainNode::Dummy(d) => layers.dummies[d].rank,
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(300))]

    #[test]
    fn the_layers_agree_with_the_ranking_and_span_every_bundle_across_adjacent_ranks(
        (count, edges) in layering_case(),
    ) {
        let rules: Vec<EdgeRule> = edges.iter().map(|&(_, _, k)| layering_rule(k)).collect();
        let budget = balanced();
        let no_bands = vec![None; count];
        let graph = indexed(count, &pairs_of(&edges));
        let result = rank(&graph, &options(PartitionMode::Soft, &no_bands, &rules, &budget))
            .expect("ranks");
        let layers = layer(&graph, &rules, &result.ranks);
        for (i, (&(s, t), rule)) in pairs_of(&edges).iter().zip(&rules).enumerate() {
            if !rule.ranks || s == t {
                continue;
            }
            let forward = result.ranks[s] <= result.ranks[t];
            prop_assert_eq!(result.reversed.contains(&i), !forward);
        }
        for bundle in &layers.bundles {
            if bundle.flat {
                prop_assert_eq!(
                    chain_rank(&layers, &result.ranks, bundle.chain[0]).to_bits(),
                    chain_rank(&layers, &result.ranks, bundle.chain[1]).to_bits()
                );
                continue;
            }
            prop_assert_eq!(bundle.reversed, result.ranks[bundle.source] > result.ranks[bundle.target]);
            let first = chain_rank(&layers, &result.ranks, bundle.chain[0]);
            for (k, &x) in bundle.chain.iter().enumerate() {
                prop_assert_eq!(chain_rank(&layers, &result.ranks, x).to_bits(), (first + f(k)).to_bits());
            }
        }
    }
}

/// A graph of three nodes, with the edge kinds of `layering.test.ts`: dependency, heavy and column.
fn layer_of(pairs: &[(usize, usize)], kinds: &[usize], ranks: &[f64]) -> Layers {
    let rules: Vec<EdgeRule> = kinds.iter().map(|&k| layering_rule(k)).collect();
    layer(&indexed(ranks.len(), pairs), &rules, ranks)
}

#[test]
fn a_long_edge_is_carried_by_one_dummy_per_intermediate_rank() {
    // a -> c across ranks 0 .. 3, with b on rank 1.
    let layers = layer_of(&[(0, 2)], &[0], &[0.0, 1.0, 3.0]);
    let bundle = &layers.bundles[0];
    assert_eq!(bundle.chain.len(), 4);
    assert_eq!(bundle.chain[0], ChainNode::Node(0));
    assert_eq!(bundle.chain[3], ChainNode::Node(2));
    let keys: Vec<(usize, f64, usize)> = layers
        .dummies
        .iter()
        .map(|k| (k.owner, k.rank, k.position))
        .collect();
    assert_eq!(keys, vec![(0, 1.0, 1), (0, 2.0, 2)]);
    assert_eq!(bundle.weight, 1.0);
}

#[test]
fn parallel_edges_of_one_kind_share_a_chain_sized_by_member_count() {
    let layers = layer_of(&[(0, 1), (0, 1), (0, 1)], &[0, 0, 0], &[0.0, 1.0]);
    assert_eq!(layers.bundles.len(), 1);
    assert_eq!(layers.bundles[0].edges, vec![0, 1, 2]);
    assert_eq!(layers.bundles[0].weight, 3.0_f64.sqrt());
    assert_eq!(layers.dummies.len(), 0);
}

#[test]
fn one_bundle_per_kind_between_the_same_pair() {
    let layers = layer_of(&[(0, 1), (0, 1)], &[0, 2], &[0.0, 0.0]);
    let kinds: Vec<usize> = layers.bundles.iter().map(|b| b.kind).collect();
    assert_eq!(kinds, vec![0, 2]);
}

#[test]
fn a_same_rank_bundle_is_flat_with_no_dummies() {
    let layers = layer_of(&[(0, 1)], &[2], &[2.0, 2.0]);
    let bundle = &layers.bundles[0];
    assert!(bundle.flat);
    assert_eq!(bundle.chain, vec![ChainNode::Node(0), ChainNode::Node(1)]);
    assert_eq!(layers.dummies.len(), 0);
}

#[test]
fn a_bundle_running_against_its_ranks_is_reversed_with_its_target_above() {
    let layers = layer_of(&[(0, 1)], &[0], &[1.0, 0.0]);
    let bundle = &layers.bundles[0];
    assert!(bundle.reversed);
    assert_eq!(bundle.chain, vec![ChainNode::Node(1), ChainNode::Node(0)]);
}

#[test]
fn self_loops_take_no_part() {
    let layers = layer_of(&[(0, 0)], &[0], &[0.0]);
    assert_eq!(layers.bundles.len(), 0);
}
