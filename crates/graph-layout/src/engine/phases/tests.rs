//! Properties of the phases on random graphs, and the refusals of `run_phases`. The checks are the core's own: every rank
//! assignment is valid, each layer is a permutation of its units, dummy chains are contiguous, and the same input gives
//! the same output. The failing seeds of proptest are committed under `proptest-regressions/`.

use std::collections::BTreeMap;

use proptest::prelude::*;

use super::{PhaseError, Phases, run_phases, to_uint32, whole_rank};
use crate::model::{
    Clusters, Direction, EdgeKindPolicy, Edges, Graph, Hints, Nodes, Options, Partitions, Ports,
};

/// A node number as a float. Test sizes are far below 2^32.
fn f(n: usize) -> f64 {
    f64::from(u32::try_from(n).expect("test sizes fit in u32"))
}

/// The index of the node named `id`.
fn index_of(ids: &[String], id: &str) -> usize {
    ids.iter()
        .position(|x| x == id)
        .expect("an edge names a node")
}

/// Hint rows for the nodes of a graph of `count` nodes: each row names a node by index (taken modulo the count), with
/// a hinted rank and order. A graph with no node takes no rows.
fn hints_of(count: usize, rows: &[(usize, u32, u32)]) -> Hints {
    let rows: &[(usize, u32, u32)] = if count == 0 { &[] } else { rows };
    Hints {
        id: rows
            .iter()
            .map(|&(i, _, _)| format!("n{}", i % count))
            .collect(),
        rank: rows.iter().map(|&(_, rank, _)| rank).collect(),
        order: rows.iter().map(|&(_, _, order)| order).collect(),
        x: vec![0.0; rows.len()],
        y: vec![0.0; rows.len()],
    }
}

/// The edges of a graph of `count` nodes: each raw edge joins two nodes (taken modulo the count) with one of four kinds.
/// Kind 0 ranks with minimum length 1, kind 1 ranks with minimum length 2, kind 2 does not rank, kind 3 has no policy.
fn edges_of(count: usize, raw: &[(usize, usize, usize)]) -> Edges {
    const KINDS: [&str; 4] = ["rank", "stretch", "info", "plain"];
    let pairs: Vec<(usize, usize, usize)> = if count == 0 {
        Vec::new()
    } else {
        raw.iter()
            .map(|&(a, b, k)| (a % count, b % count, k))
            .collect()
    };
    Edges {
        id: (0..pairs.len()).map(|i| format!("e{i}")).collect(),
        source: pairs.iter().map(|p| format!("n{}", p.0)).collect(),
        target: pairs.iter().map(|p| format!("n{}", p.1)).collect(),
        source_port: vec![None; pairs.len()],
        target_port: vec![None; pairs.len()],
        kind: pairs.iter().map(|p| KINDS[p.2].to_owned()).collect(),
    }
}

/// A random graph with its options: up to eight nodes, with partition bands, sizes and clusters; up to 24 edges; and
/// the direction, partition mode, effort, stability, hints and seed of the run.
fn case() -> impl Strategy<Value = (Graph, Options)> {
    (
        prop::collection::vec(
            (
                prop::option::of(0_u8..3),
                1_u8..=6,
                1_u8..=6,
                prop::option::of(0_u8..2),
            ),
            0..=8,
        ),
        prop::collection::vec((0_usize..64, 0_usize..64, 0_usize..4), 0..24),
        prop::bool::ANY,
        (0_u8..4, 0_u8..3, 0_u8..3),
        prop::option::of(prop::collection::vec(
            (0_usize..64, 0_u32..4, 0_u32..4),
            0..6,
        )),
        prop::option::of(-5_i16..5000),
    )
        .prop_map(
            |(nodes, raw_edges, right, (partitions, effort, stability), hints, seed)| {
                let count = nodes.len();
                let graph = Graph {
                    nodes: Nodes {
                        id: (0..count).map(|i| format!("n{i}")).collect(),
                        width: nodes.iter().map(|n| f64::from(n.1)).collect(),
                        height: nodes.iter().map(|n| f64::from(n.2)).collect(),
                        cluster: nodes.iter().map(|n| n.3.map(|c| format!("c{c}"))).collect(),
                        partition: nodes.iter().map(|n| n.0.map(f64::from)).collect(),
                        ports: Ports::default(),
                    },
                    edges: edges_of(count, &raw_edges),
                    clusters: Clusters {
                        id: vec!["c0".to_owned(), "c1".to_owned()],
                        parent: vec![None, None],
                        ..Clusters::default()
                    },
                };
                let options = Options {
                    direction: if right {
                        Direction::Right
                    } else {
                        Direction::Down
                    },
                    edge_kinds: edge_kinds(),
                    partitions: match partitions {
                        0 => Some(Partitions::None),
                        1 => Some(Partitions::Soft),
                        2 => Some(Partitions::Strict),
                        _ => None,
                    },
                    hints: hints.map(|rows| hints_of(count, &rows)),
                    stability: match stability {
                        1 => Some(0.0),
                        2 => Some(2.0),
                        _ => None,
                    },
                    effort: match effort {
                        0 => Some("fast".to_owned()),
                        1 => Some("balanced".to_owned()),
                        _ => None,
                    },
                    seed: seed.map(f64::from),
                    ..Options::default()
                };
                (graph, options)
            },
        )
}

/// The policies of the kinds `edges_of` uses: `rank` and `stretch` rank, `info` does not, and `plain` has no policy.
fn edge_kinds() -> BTreeMap<String, EdgeKindPolicy> {
    BTreeMap::from([
        (
            "rank".to_owned(),
            EdgeKindPolicy {
                ranks: true,
                min_length: Some(1.0),
                weight: Some(1.0),
                ..EdgeKindPolicy::default()
            },
        ),
        (
            "stretch".to_owned(),
            EdgeKindPolicy {
                ranks: true,
                min_length: Some(2.0),
                weight: Some(2.0),
                ..EdgeKindPolicy::default()
            },
        ),
        (
            "info".to_owned(),
            EdgeKindPolicy {
                ranks: false,
                ..EdgeKindPolicy::default()
            },
        ),
    ])
}

/// Every ranking edge spans its minimum length in the direction it is laid out, and a reversed edge is one that ranks.
fn assert_ranks_valid(graph: &Graph, options: &Options, phases: &Phases) {
    assert_eq!(phases.ranks.len(), graph.nodes.id.len());
    if let Some(&low) = phases.ranks.iter().min() {
        assert_eq!(low, 0, "the lowest real node is at rank 0");
    }
    for (edge, kind) in graph.edges.kind.iter().enumerate() {
        let reversed = phases.reversed.contains(&edge);
        let Some(policy) = options.edge_kinds.get(kind).filter(|p| p.ranks) else {
            assert!(
                !reversed,
                "edge {edge} does not rank, so it is not reversed"
            );
            continue;
        };
        let source = index_of(&graph.nodes.id, &graph.edges.source[edge]);
        let target = index_of(&graph.nodes.id, &graph.edges.target[edge]);
        if source == target {
            continue;
        }
        let (from, to) = if reversed {
            (target, source)
        } else {
            (source, target)
        };
        let min_length = policy.min_length.unwrap_or(1.0);
        assert!(
            f(phases.ranks[to]) >= f(phases.ranks[from]) + min_length,
            "edge {edge} spans its minimum length"
        );
    }
}

/// Each rank's order holds each of its layered nodes once, and no other node.
fn assert_layers_are_permutations(phases: &Phases) {
    let layered = &phases.layered;
    assert_eq!(phases.layers.len(), layered.ranks);
    for (rank, layer) in phases.layers.iter().enumerate() {
        let mut units = layer.clone();
        units.sort_unstable();
        let expected: Vec<usize> = (0..layered.nodes.len())
            .filter(|&x| layered.nodes[x].rank == rank)
            .collect();
        assert_eq!(units, expected, "rank {rank} holds each of its units once");
    }
}

/// Each segment joins adjacent ranks, and each dummy that a chain passes through has one segment in and one out.
fn assert_chains_are_contiguous(phases: &Phases) {
    let layered = &phases.layered;
    for segment in &layered.segments {
        assert_eq!(
            layered.nodes[segment.bottom].rank,
            layered.nodes[segment.top].rank + 1,
            "a segment joins adjacent ranks"
        );
    }
    for (x, node) in layered.nodes.iter().enumerate() {
        if node.id.is_some() {
            continue;
        }
        let into = layered.segments.iter().filter(|s| s.bottom == x).count();
        let out = layered.segments.iter().filter(|s| s.top == x).count();
        assert!(
            into <= 1 && into == out,
            "dummy {x} lies on one chain, once in and once out, or on a spine only"
        );
    }
}

proptest! {
    #[test]
    fn every_rank_assignment_is_valid((graph, options) in case()) {
        let phases = run_phases(&graph, &options).expect("a graph without lateral ports runs");
        assert_ranks_valid(&graph, &options, &phases);
    }

    #[test]
    fn every_layer_is_a_permutation_of_its_units((graph, options) in case()) {
        let phases = run_phases(&graph, &options).expect("a graph without lateral ports runs");
        assert_layers_are_permutations(&phases);
    }

    #[test]
    fn dummy_chains_are_contiguous((graph, options) in case()) {
        let phases = run_phases(&graph, &options).expect("a graph without lateral ports runs");
        assert_chains_are_contiguous(&phases);
    }

    #[test]
    fn the_same_input_gives_the_same_output((graph, options) in case()) {
        let first = run_phases(&graph, &options);
        let second = run_phases(&graph, &options);
        prop_assert_eq!(first, second);
    }
}

/// A graph of `ids` nodes (10 by 10) joined by dependency edges between the given pairs of ids.
fn graph_of(ids: &[&str], pairs: &[(&str, &str)]) -> Graph {
    let (n, m) = (ids.len(), pairs.len());
    Graph {
        nodes: Nodes {
            id: ids.iter().map(|id| (*id).to_owned()).collect(),
            width: vec![10.0; n],
            height: vec![10.0; n],
            cluster: vec![None; n],
            partition: vec![None; n],
            ports: Ports::default(),
        },
        edges: Edges {
            id: (0..m).map(|i| format!("e{i}")).collect(),
            source: pairs.iter().map(|p| p.0.to_owned()).collect(),
            target: pairs.iter().map(|p| p.1.to_owned()).collect(),
            source_port: vec![None; m],
            target_port: vec![None; m],
            kind: vec!["dependency".to_owned(); m],
        },
        clusters: Clusters::default(),
    }
}

/// Options with one ranking kind, `dependency`, of minimum length 1.
fn dependency_options() -> Options {
    Options {
        edge_kinds: BTreeMap::from([(
            "dependency".to_owned(),
            EdgeKindPolicy {
                ranks: true,
                ..EdgeKindPolicy::default()
            },
        )]),
        ..Options::default()
    }
}

#[test]
fn a_chain_has_one_node_per_rank_and_per_layer() {
    let graph = graph_of(&["a", "b", "c"], &[("a", "b"), ("b", "c")]);
    let phases = run_phases(&graph, &dependency_options()).expect("a chain runs");
    assert_eq!(phases.ranks, vec![0, 1, 2]);
    assert_eq!(phases.layers, vec![vec![0], vec![1], vec![2]]);
    assert_eq!(phases.crossings, 0.0);
}

#[test]
fn an_edge_across_two_ranks_gets_one_dummy_in_the_middle_rank() {
    let graph = graph_of(&["a", "b", "c"], &[("a", "b"), ("b", "c"), ("a", "c")]);
    let phases = run_phases(&graph, &dependency_options()).expect("a triangle runs");
    assert_eq!(phases.ranks, vec![0, 1, 2]);
    let dummy = &phases.layered.nodes[3];
    assert_eq!((dummy.id, dummy.rank), (None, 1));
    let mut middle = phases.layers[1].clone();
    middle.sort_unstable();
    assert_eq!(middle, vec![1, 3]);
}

#[test]
fn an_empty_graph_has_no_ranks_and_no_layers() {
    let phases = run_phases(&graph_of(&[], &[]), &Options::default()).expect("nothing to lay out");
    assert_eq!(phases.ranks, Vec::<usize>::new());
    assert_eq!(phases.layers, Vec::<Vec<usize>>::new());
    assert_eq!(phases.layered.nodes.len(), 0);
}

#[test]
fn a_lateral_port_that_an_edge_leaves_through_is_refused() {
    let mut graph = graph_of(&["a", "b"], &[("a", "b")]);
    graph.nodes.ports = Ports {
        node: vec![0],
        id: vec!["p".to_owned()],
        side: vec!["east".to_owned()],
        offset: vec![1.0],
    };
    graph.edges.source_port = vec![Some("p".to_owned())];
    assert_eq!(
        run_phases(&graph, &dependency_options()),
        Err(PhaseError::LateralPort)
    );
}

#[test]
fn an_effort_with_no_budget_is_refused_by_name() {
    let options = Options {
        effort: Some("slow".to_owned()),
        ..dependency_options()
    };
    assert_eq!(
        run_phases(&graph_of(&["a"], &[]), &options),
        Err(PhaseError::UnknownEffort("slow".to_owned()))
    );
}

#[test]
fn a_fractional_minimum_length_is_refused() {
    let mut options = dependency_options();
    let policy = options
        .edge_kinds
        .get_mut("dependency")
        .expect("the policy is set");
    policy.min_length = Some(1.5);
    assert_eq!(
        run_phases(&graph_of(&["a", "b"], &[("a", "b")]), &options),
        Err(PhaseError::NonIntegerRank)
    );
}

#[test]
fn the_seed_reads_as_the_typescript_unsigned_shift() {
    assert_eq!(to_uint32(0.0), 0);
    assert_eq!(to_uint32(42.9), 42);
    assert_eq!(to_uint32(-1.0), u32::MAX);
    assert_eq!(to_uint32(4_294_967_301.0), 5);
    assert_eq!(to_uint32(f64::NAN), 0);
    assert_eq!(to_uint32(f64::INFINITY), 0);
}

#[test]
fn a_rank_is_whole_only_below_2_to_the_32() {
    assert_eq!(whole_rank(3.0), Some(3));
    assert_eq!(whole_rank(1.5), None);
    assert_eq!(whole_rank(-1.0), None);
    assert_eq!(whole_rank(4_294_967_296.0), None);
    assert_eq!(whole_rank(f64::NAN), None);
}

#[test]
fn the_hints_of_a_graph_name_its_nodes_by_index() {
    let rows = hints_of(2, &[(3, 1, 0)]);
    assert_eq!(rows.id, vec!["n1".to_owned()]);
    assert_eq!(rows.rank, vec![1]);
    assert_eq!(rows.order, vec![0]);
}
