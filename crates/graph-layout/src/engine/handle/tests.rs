//! The engine handle: I1, the cache and the cancellation. I1 is a proptest: the handle after every change of a random
//! sequence equals a fresh `layout` on the same inputs, byte for byte. The cache tests fix which stages a change re-runs.
//! The cancel tests fix that a superseded request returns nothing and leaves the cache as it was.

use std::cell::Cell;
use std::collections::BTreeMap;

use proptest::prelude::*;

use super::{Engine, Generation, Progress};
use crate::engine::keys::Stage;
use crate::engine::layout::layout;
use crate::engine::phases::tests::case;
use crate::model::{
    Clusters, EdgeKindPolicy, Edges, Graph, Nodes, Options, PartialSpacing, Ports, encode_layout,
};

/// The graph of the cache tests: a chain `a -> b -> c` of ranking edges and a routed `info` edge from `a` to `c`.
fn chain() -> Graph {
    fn ids(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| (*name).to_owned()).collect()
    }
    Graph {
        nodes: Nodes {
            id: ids(&["a", "b", "c"]),
            width: vec![40.0; 3],
            height: vec![20.0; 3],
            cluster: vec![None; 3],
            partition: vec![None; 3],
            ports: Ports::default(),
        },
        edges: Edges {
            id: ids(&["ab", "bc", "ac"]),
            source: ids(&["a", "b", "a"]),
            target: ids(&["b", "c", "c"]),
            source_port: vec![None; 3],
            target_port: vec![None; 3],
            kind: ids(&["rank", "rank", "info"]),
        },
        clusters: Clusters::default(),
    }
}

/// The options of the cache tests: the `rank` kind ranks, and the `info` kind is routed without ranking.
fn options() -> Options {
    Options {
        edge_kinds: BTreeMap::from([
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
                "info".to_owned(),
                EdgeKindPolicy {
                    routed: Some(true),
                    ..EdgeKindPolicy::default()
                },
            ),
        ]),
        ..Options::default()
    }
}

/// A node spacing of `node`, and nothing else set.
fn node_spacing(node: f64) -> Options {
    Options {
        spacing: Some(PartialSpacing {
            node: Some(node),
            ..PartialSpacing::default()
        }),
        ..options()
    }
}

/// The request of `generation`, run to the end: its progress, which is `Some` for a request nothing supersedes.
fn run(engine: &Engine, graph: &Graph, options: &Options, generation: u64) -> Progress {
    engine
        .layout(graph, options, Generation::new(generation))
        .expect("the options are valid")
        .expect("no newer generation has started")
}

/// The random cases, with every edge kind valid for `validate`: a `plain` edge has no policy, so it takes the `info` kind,
/// which does not rank and is routed.
fn valid((mut graph, options): (Graph, Options)) -> (Graph, Options) {
    for kind in &mut graph.edges.kind {
        if kind.as_str() == "plain" {
            *kind = "info".to_owned();
        }
    }
    (graph, options)
}

proptest! {
    /// I1: after every change of a random sequence of options on a random graph, the handle's layout is the fresh
    /// `layout` of the same inputs, byte for byte. Each request has a newer generation than the one before it, so none is
    /// superseded.
    #[test]
    fn the_handle_after_a_sequence_of_changes_equals_a_fresh_layout(
        (graph, first) in case().prop_map(valid),
        rest in prop::collection::vec(case().prop_map(|(_, options)| options), 0..4),
    ) {
        let engine = Engine::new();
        for (step, options) in std::iter::once(first).chain(rest).enumerate() {
            let generation = Generation::new(u64::try_from(step).unwrap_or(u64::MAX));
            let handled = engine
                .layout(&graph, &options, generation)
                .map(|progress| encode_layout(&progress.expect("generations increase, so no request is superseded").into_layout()));
            let fresh = layout(&graph, &options).map(|layout| encode_layout(&layout));
            prop_assert_eq!(handled, fresh);
        }
    }
}

#[test]
fn the_first_request_runs_every_stage() {
    let engine = Engine::new();
    let first = run(&engine, &chain(), &options(), 1);
    assert_eq!(first.reran(), &Stage::ALL);
}

#[test]
fn an_unchanged_request_reruns_no_stage() {
    let engine = Engine::new();
    let graph = chain();
    let first = run(&engine, &graph, &options(), 1);
    let second = run(&engine, &graph, &options(), 2);
    assert_eq!(second.reran(), &[] as &[Stage]);
    assert_eq!(second.layout(), first.layout());
}

/// `spacing.node` is read by placement and by nothing before it, so a change of it re-runs placement and the routing that
/// follows it, and nothing else. No option is read by routing alone: the key table in ADR 0011 (see `keys/tests.rs`) has
/// no option whose only stage is route, so this is the nearest case to routing-only.
#[test]
fn a_placement_only_change_reruns_placement_and_routing() {
    let engine = Engine::new();
    let graph = chain();
    run(&engine, &graph, &options(), 1);
    let moved = run(&engine, &graph, &node_spacing(20.0), 2);
    assert_eq!(moved.reran(), &[Stage::Place, Stage::Route]);
    assert_eq!(
        moved.layout(),
        &layout(&graph, &node_spacing(20.0)).expect("valid")
    );
}

/// `spacing.edge` is read by build, so a change of it re-runs every stage from build on.
#[test]
fn a_build_read_change_reruns_from_build() {
    let engine = Engine::new();
    let graph = chain();
    run(&engine, &graph, &options(), 1);
    let moved = Options {
        spacing: Some(PartialSpacing {
            edge: Some(9.0),
            ..PartialSpacing::default()
        }),
        ..options()
    };
    let progress = run(&engine, &graph, &moved, 2);
    assert_eq!(
        progress.reran(),
        &[Stage::Build, Stage::Order, Stage::Place, Stage::Route]
    );
}

#[test]
fn an_older_generation_returns_nothing_once_a_newer_one_has_started() {
    let engine = Engine::new();
    let graph = chain();
    run(&engine, &graph, &options(), 2);
    let superseded = engine
        .layout(&graph, &node_spacing(20.0), Generation::new(1))
        .expect("the options are valid");
    assert!(superseded.is_none());
}

/// A superseded run returns nothing and keeps the cache it would have replaced: the next request on the old inputs reruns
/// no stage and returns the layout it had before.
#[test]
fn a_run_superseded_mid_way_leaves_the_cache_as_it_was() {
    let engine = Engine::new();
    let graph = chain();
    let first = run(&engine, &graph, &options(), 1);

    // The moved request re-runs placement, then asks before routing: that answer supersedes it.
    let asked = Cell::new(0_u32);
    let superseded = engine
        .advance(&graph, &node_spacing(20.0), Generation::new(2), &|| {
            asked.set(asked.get() + 1);
            asked.get() < 2
        })
        .expect("the options are valid");
    assert!(superseded.is_none());
    assert_eq!(asked.get(), 2, "the run stopped at the route stage");

    let again = run(&engine, &graph, &options(), 3);
    assert_eq!(again.reran(), &[] as &[Stage]);
    assert_eq!(again.layout(), first.layout());
}
