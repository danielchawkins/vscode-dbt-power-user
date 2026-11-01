//! S7: which stages each option reaches. The probe starts from a base that sets every option, changes one option at a
//! time, and marks each stage whose key changes. The result must equal the key table in ADR 0011 ("Live tuning"),
//! between its `key-table` markers.

use std::collections::BTreeMap;

use super::{Stage, stage_keys};
use crate::engine::phases::budget_of;
use crate::model::{
    Clusters, Direction, EdgeKindPolicy, Edges, Graph, Hints, Nodes, Options, PartialSpacing,
    Partitions, Ports, Ranks,
};

fn ids(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| (*name).to_owned()).collect()
}

/// A chain `a -> b -> c` of `rank` edges and an `info` edge from `a` to `c`.
fn graph() -> Graph {
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

/// Every option set, so a change of any one of them is a change of value, not of presence.
fn base() -> Options {
    Options {
        direction: Direction::Down,
        edge_kinds: BTreeMap::from([
            (
                "rank".to_owned(),
                EdgeKindPolicy {
                    ranks: true,
                    min_length: Some(1.0),
                    weight: Some(1.0),
                    routed: Some(true),
                    source_side: Some("bottom".to_owned()),
                    target_side: Some("top".to_owned()),
                },
            ),
            (
                "info".to_owned(),
                EdgeKindPolicy {
                    weight: Some(1.0),
                    routed: Some(true),
                    ..EdgeKindPolicy::default()
                },
            ),
        ]),
        spacing: Some(PartialSpacing {
            node: Some(10.0),
            rank: Some(30.0),
            edge: Some(5.0),
            cluster: Some(12.0),
        }),
        partitions: Some(Partitions::Soft),
        ranks: Some(Ranks::Rows),
        anchor: Some("a".to_owned()),
        hints: Some(Hints {
            id: ids(&["a", "b", "c"]),
            rank: vec![0, 1, 2],
            order: vec![0, 0, 0],
            x: vec![0.0, 0.0, 0.0],
            y: vec![0.0, 50.0, 100.0],
        }),
        stability: Some(1.0),
        effort: Some("balanced".to_owned()),
        seed: Some(3.0),
    }
}

fn kind<'a>(options: &'a mut Options, name: &str) -> &'a mut EdgeKindPolicy {
    options
        .edge_kinds
        .get_mut(name)
        .expect("the base sets every kind")
}

fn spacing(options: &mut Options) -> &mut PartialSpacing {
    options.spacing.as_mut().expect("the base sets spacing")
}

fn hints(options: &mut Options) -> &mut Hints {
    options.hints.as_mut().expect("the base sets hints")
}

/// A row label of the ADR's table, and the change of the base that probes it.
type Probe = (&'static str, fn(&mut Options));

/// Each probed option, by its row label in the ADR, with the change that probes it.
fn probes() -> Vec<Probe> {
    vec![
        ("direction", |o| {
            o.direction = Direction::Right;
        }),
        ("edgeKinds.rank.ranks", |o| {
            kind(o, "rank").ranks = false;
        }),
        ("edgeKinds.rank.minLength", |o| {
            kind(o, "rank").min_length = Some(2.0);
        }),
        ("edgeKinds.rank.weight", |o| {
            kind(o, "rank").weight = Some(2.0);
        }),
        ("edgeKinds.rank.routed", |o| {
            kind(o, "rank").routed = Some(false);
        }),
        ("edgeKinds.rank.sourceSide", |o| {
            kind(o, "rank").source_side = Some("right".to_owned());
        }),
        ("edgeKinds.rank.targetSide", |o| {
            kind(o, "rank").target_side = Some("left".to_owned());
        }),
        ("edgeKinds.info.weight", |o| {
            kind(o, "info").weight = Some(3.0);
        }),
        ("spacing.node", |o| {
            spacing(o).node = Some(20.0);
        }),
        ("spacing.rank", |o| {
            spacing(o).rank = Some(60.0);
        }),
        ("spacing.edge", |o| {
            spacing(o).edge = Some(9.0);
        }),
        ("spacing.cluster", |o| {
            spacing(o).cluster = Some(24.0);
        }),
        ("partitions", |o| {
            o.partitions = Some(Partitions::Strict);
        }),
        ("ranks", |o| {
            o.ranks = Some(Ranks::Levels);
        }),
        ("anchor", |o| {
            o.anchor = Some("b".to_owned());
        }),
        ("hints (presence)", |o| {
            o.hints = None;
        }),
        ("hints.id and hints.rank", |o| {
            hints(o).rank = vec![0, 2, 4];
        }),
        ("hints.order", |o| {
            hints(o).order = vec![1, 0, 0];
        }),
        ("hints.x", |o| {
            hints(o).x = vec![5.0, 0.0, 0.0];
        }),
        ("hints.y", |o| {
            hints(o).y = vec![0.0, 60.0, 100.0];
        }),
        ("stability", |o| {
            o.stability = Some(0.5);
        }),
        ("effort", |o| {
            o.effort = Some("thorough".to_owned());
        }),
        ("seed", |o| {
            o.seed = Some(7.0);
        }),
    ]
}

fn keys(graph: &Graph, options: &Options) -> [u64; Stage::COUNT] {
    let budget = budget_of(options).expect("the probed efforts are valid");
    stage_keys(graph, options, &budget)
}

/// The probe's table: for each option, its label and whether each stage's key changes.
fn probed() -> Vec<(String, [bool; Stage::COUNT])> {
    let graph = graph();
    let before = keys(&graph, &base());
    probes()
        .into_iter()
        .map(|(label, change)| {
            let mut options = base();
            change(&mut options);
            let after = keys(&graph, &options);
            (
                label.to_owned(),
                std::array::from_fn(|i| before[i] != after[i]),
            )
        })
        .collect()
}

/// The ADR's table, between its markers: each body row's label, without backticks, and its marked stages.
fn documented() -> Vec<(String, [bool; Stage::COUNT])> {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../docs/adr/0011-graph-layout-in-rust.md"
    );
    let adr = std::fs::read_to_string(path).expect("ADR 0011 is readable");
    let start = adr
        .find("<!-- key-table:start -->")
        .expect("the ADR has the start marker");
    let end = adr
        .find("<!-- key-table:end -->")
        .expect("the ADR has the end marker");
    adr[start..end]
        .lines()
        .filter(|line| line.starts_with('|'))
        .skip(2)
        .map(|line| {
            let cells: Vec<&str> = line.trim_matches('|').split('|').map(str::trim).collect();
            assert_eq!(
                cells.len(),
                Stage::COUNT + 1,
                "row {line:?} has a cell per stage"
            );
            let marks = std::array::from_fn(|i| match cells[i + 1] {
                "●" => true,
                "" => false,
                other => panic!("row {line:?} has the mark {other:?}"),
            });
            (cells[0].trim_matches('`').to_owned(), marks)
        })
        .collect()
}

#[test]
#[cfg_attr(target_os = "wasi", ignore = "the WASI sandbox cannot read the ADR")]
fn the_adr_key_table_is_the_probes_output() {
    assert_eq!(documented(), probed());
}

#[test]
fn every_stage_after_a_reached_stage_is_reached() {
    for (label, marks) in probed() {
        if let Some(first) = marks.iter().position(|&m| m) {
            assert!(
                marks[first..].iter().all(|&m| m),
                "{label} reaches a stage and skips a later one"
            );
        }
    }
}
