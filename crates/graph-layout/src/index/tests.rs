//! Tests of the dense view: the ids, the adjacency and the components, ported from `indexed.test.ts`. The components are
//! checked against a brute-force union-find under proptest.

use std::collections::BTreeMap;

use proptest::prelude::*;

use super::Indexed;
use crate::model::{EdgeKindPolicy, Edges, Graph, Nodes, Options};

/// A graph of nodes `ids`, and edges given as (id, source, target, kind).
fn graph(ids: &[&str], edges: &[(&str, &str, &str, &str)]) -> Graph {
    Graph {
        nodes: Nodes {
            id: ids.iter().map(|id| (*id).to_owned()).collect(),
            width: vec![10.0; ids.len()],
            height: vec![10.0; ids.len()],
            cluster: vec![None; ids.len()],
            partition: vec![None; ids.len()],
            ..Nodes::default()
        },
        edges: Edges {
            id: edges.iter().map(|e| e.0.to_owned()).collect(),
            source: edges.iter().map(|e| e.1.to_owned()).collect(),
            target: edges.iter().map(|e| e.2.to_owned()).collect(),
            kind: edges.iter().map(|e| e.3.to_owned()).collect(),
            ..Edges::default()
        },
        ..Graph::default()
    }
}

/// The three policies of `indexed.test.ts`: `dependency` ranks, `column` ranks no edge but is routed, and
/// `relationship` neither ranks nor is routed.
fn policies() -> BTreeMap<String, EdgeKindPolicy> {
    BTreeMap::from([
        (
            "dependency".to_owned(),
            EdgeKindPolicy {
                ranks: true,
                ..EdgeKindPolicy::default()
            },
        ),
        (
            "column".to_owned(),
            EdgeKindPolicy {
                ranks: false,
                ..EdgeKindPolicy::default()
            },
        ),
        (
            "relationship".to_owned(),
            EdgeKindPolicy {
                ranks: false,
                routed: Some(false),
                ..EdgeKindPolicy::default()
            },
        ),
    ])
}

const KINDS: [&str; 3] = ["dependency", "column", "relationship"];

fn options() -> Options {
    Options {
        edge_kinds: policies(),
        ..Options::default()
    }
}

#[test]
fn maps_each_node_id_to_its_index_and_each_edge_to_its_ends() {
    let g = graph(
        &["a", "b", "c"],
        &[
            ("e1", "a", "b", "dependency"),
            ("e2", "b", "c", "dependency"),
        ],
    );
    let input = Indexed::new(&g, None);
    assert_eq!(input.node("a"), Some(0));
    assert_eq!(input.node("b"), Some(1));
    assert_eq!(input.node("c"), Some(2));
    assert_eq!(input.node("missing"), None);
    assert_eq!(input.ends(1), Some((1, 2)));
    assert_eq!(input.node_count(), 3);
    assert_eq!(input.edge_count(), 2);
}

#[test]
fn indexes_a_graph_with_no_nodes_and_no_edges() {
    let input = Indexed::new(&graph(&[], &[]), None);
    assert_eq!(input.node_count(), 0);
    assert_eq!(input.edge_count(), 0);
    assert_eq!(input.component_count(), 0);
}

#[test]
fn a_duplicate_node_id_maps_to_its_last_index() {
    let input = Indexed::new(&graph(&["a", "b", "a"], &[]), None);
    assert_eq!(input.node("a"), Some(2));
}

#[test]
fn adjacency_lists_edges_in_input_order_and_skips_unknown_ends() {
    let g = graph(
        &["a", "b", "c"],
        &[
            ("e0", "a", "b", "dependency"),
            ("e1", "a", "c", "dependency"),
            ("e2", "a", "ghost", "dependency"),
            ("e3", "b", "b", "dependency"),
            ("e4", "c", "a", "dependency"),
        ],
    );
    let input = Indexed::new(&g, None);
    assert_eq!(input.ends(2), None);
    assert_eq!(input.out_edges(0), &[0, 1]);
    assert_eq!(input.out_edges(1), &[3]);
    assert_eq!(input.out_edges(2), &[4]);
    assert_eq!(input.in_edges(0), &[4]);
    assert_eq!(input.in_edges(1), &[0, 3]);
    assert_eq!(input.in_edges(2), &[1]);
}

#[test]
fn leaves_out_an_edge_that_neither_ranks_nor_is_routed() {
    let g = graph(
        &["a", "b", "c"],
        &[
            ("r", "a", "b", "relationship"),
            ("d", "b", "c", "dependency"),
        ],
    );
    let with = Indexed::new(&g, Some(&options()));
    let components: Vec<u32> = (0..3).map(|n| with.component(n)).collect();
    assert_eq!(components, [0, 1, 1]);
    assert_eq!(with.component_count(), 2);

    let without = Indexed::new(&g, None);
    let components: Vec<u32> = (0..3).map(|n| without.component(n)).collect();
    assert_eq!(components, [0, 0, 0]);
    assert_eq!(without.component_count(), 1);
}

/// The component of each node by relabelling: every node starts alone, and each joining edge relabels both ends'
/// components to one label. Numbers follow the first node of each component.
fn brute_force(node_count: usize, ends: &[Option<(u32, u32)>], joins: &[bool]) -> Vec<u32> {
    let mut label: Vec<usize> = (0..node_count).collect();
    for (end, joined) in ends.iter().zip(joins) {
        let Some((a, b)) = *end else { continue };
        if !joined {
            continue;
        }
        let (from, to) = (label[a as usize], label[b as usize]);
        for l in &mut label {
            if *l == from {
                *l = to;
            }
        }
    }
    let mut numbers: BTreeMap<usize, u32> = BTreeMap::new();
    label
        .iter()
        .map(|l| {
            let next = u32::try_from(numbers.len()).unwrap_or(u32::MAX);
            *numbers.entry(*l).or_insert(next)
        })
        .collect()
}

/// Random graphs of up to twelve nodes, with edges of every policy among them, self-loops and parallel edges included.
fn policy_graph() -> impl Strategy<Value = (usize, Vec<(u32, u32, usize)>)> {
    (
        1usize..=12,
        prop::collection::vec((0u32..100, 0u32..100, 0usize..3), 0..=20),
    )
        .prop_map(|(count, edges)| {
            let n = u32::try_from(count).unwrap_or(1);
            let edges = edges
                .into_iter()
                .map(|(f, t, k)| (f % n, t % n, k))
                .collect();
            (count, edges)
        })
}

fn policy_graph_to_model(count: usize, edges: &[(u32, u32, usize)]) -> Graph {
    let ids: Vec<String> = (0..count).map(|i| format!("n{i}")).collect();
    let names: Vec<&str> = ids.iter().map(String::as_str).collect();
    let edge_rows: Vec<(String, String, String, &str)> = edges
        .iter()
        .enumerate()
        .map(|(i, (f, t, k))| (format!("e{i}"), format!("n{f}"), format!("n{t}"), KINDS[*k]))
        .collect();
    let rows: Vec<(&str, &str, &str, &str)> = edge_rows
        .iter()
        .map(|(id, s, t, k)| (id.as_str(), s.as_str(), t.as_str(), *k))
        .collect();
    graph(&names, &rows)
}

proptest! {
    /// The components equal a brute-force union-find over the ranking and routed edges, numbered from zero in the order
    /// of each component's first node.
    #[test]
    fn components_match_brute_force_over_ranking_and_routed_edges((count, edges) in policy_graph()) {
        let g = policy_graph_to_model(count, &edges);
        let policies = policies();
        let joins: Vec<bool> = edges
            .iter()
            .map(|(_, _, k)| {
                let p = &policies[KINDS[*k]];
                p.ranks || p.routed != Some(false)
            })
            .collect();
        let ends: Vec<Option<(u32, u32)>> = edges.iter().map(|(f, t, _)| Some((*f, *t))).collect();
        let expected = brute_force(count, &ends, &joins);
        let input = Indexed::new(&g, Some(&options()));
        let actual: Vec<u32> = (0..count).map(|n| input.component(n)).collect();
        prop_assert_eq!(&actual, &expected);
        let used = actual.iter().max().map_or(0, |m| m + 1);
        prop_assert_eq!(input.component_count(), used);
    }

    /// Without a policy every edge joins its ends.
    #[test]
    fn without_a_policy_every_edge_joins_its_ends((count, edges) in policy_graph()) {
        let g = policy_graph_to_model(count, &edges);
        let ends: Vec<Option<(u32, u32)>> = edges.iter().map(|(f, t, _)| Some((*f, *t))).collect();
        let joins = vec![true; edges.len()];
        let expected = brute_force(count, &ends, &joins);
        let input = Indexed::new(&g, None);
        let actual: Vec<u32> = (0..count).map(|n| input.component(n)).collect();
        prop_assert_eq!(actual, expected);
    }
}
