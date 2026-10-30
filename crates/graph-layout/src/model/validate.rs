//! Input validation: every problem `layout` would refuse, reported at once. It is `validateGraph` in `validate.ts`, with
//! the same checks in the same order, so both engines refuse the same inputs.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use super::{EdgeKindPolicy, Graph, Options, Side};

/// What is wrong with an input element. The names are the codes of `LayoutInputIssue` in `types.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IssueCode {
    /// An id that another element of the same kind already has.
    DuplicateId,
    /// An edge end that names no node.
    UnknownNode,
    /// An edge end that names a port its node does not have.
    UnknownPort,
    /// An edge whose kind has no policy.
    UnknownKind,
    /// A node or cluster that names no cluster, or a cluster whose parent is none.
    UnknownCluster,
    /// A cluster whose chain of parents comes back to itself, a self-parent included.
    ClusterCycle,
    /// A node size, or a port size, that is not finite and positive.
    BadSize,
    /// A port or a kind default that names no side.
    BadSide,
    /// A port offset that is not within its side.
    BadOffset,
}

impl IssueCode {
    /// The code as `types.ts` spells it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::DuplicateId => "duplicate-id",
            Self::UnknownNode => "unknown-node",
            Self::UnknownPort => "unknown-port",
            Self::UnknownKind => "unknown-kind",
            Self::UnknownCluster => "unknown-cluster",
            Self::ClusterCycle => "cluster-cycle",
            Self::BadSize => "bad-size",
            Self::BadSide => "bad-side",
            Self::BadOffset => "bad-offset",
        }
    }
}

/// One problem with the input: its code, and the id of the element it is about.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InputIssue {
    /// What is wrong.
    pub code: IssueCode,
    /// The node, edge, port or cluster id. A port is `node.port`.
    pub subject: String,
}

/// The input `layout` refuses. It carries every issue at once, in the order `validate` finds them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InputError {
    issues: Vec<InputIssue>,
}

impl InputError {
    /// Every problem found, in the order `validate` found them.
    #[must_use]
    pub fn issues(&self) -> &[InputIssue] {
        &self.issues
    }
}

impl fmt::Display for InputError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid graph input ({} issues)", self.issues.len())?;
        for issue in &self.issues {
            write!(f, "; {} {}", issue.code.as_str(), issue.subject)?;
        }
        Ok(())
    }
}

impl std::error::Error for InputError {}

/// Ports of each node by id: the port ids the node has. A later node with the same id replaces an earlier one, as
/// `validate.ts` does with its `Map`.
type PortsByNode<'a> = BTreeMap<&'a str, BTreeSet<&'a str>>;

/// Checks `graph` against `options`: duplicate ids, edges to unknown nodes, ports or kinds, members of unknown
/// clusters, cluster cycles, sizes that are not finite and positive, port sides that are not sides, port offsets
/// outside their side, ports whose node index is out of range, and kind default sides that are not sides.
///
/// # Errors
///
/// Returns every problem found, when there is at least one. A graph with no problem gives `Ok(())`.
pub fn validate(graph: &Graph, options: &Options) -> Result<(), InputError> {
    let mut issues = Vec::new();
    let nodes = node_issues(graph, &mut issues);
    cluster_issues(graph, &mut issues);
    kind_issues(&options.edge_kinds, &mut issues);
    edge_issues(graph, &options.edge_kinds, &nodes, &mut issues);
    if issues.is_empty() {
        Ok(())
    } else {
        Err(InputError { issues })
    }
}

fn issue(issues: &mut Vec<InputIssue>, code: IssueCode, subject: &str) {
    issues.push(InputIssue {
        code,
        subject: subject.to_owned(),
    });
}

/// A size is finite and positive. `NaN` fails both comparisons, as `Number.isFinite` and `> 0` do in TypeScript.
fn is_size(size: f64) -> bool {
    size.is_finite() && size > 0.0
}

fn node_issues<'a>(graph: &'a Graph, issues: &mut Vec<InputIssue>) -> PortsByNode<'a> {
    let nodes = &graph.nodes;
    let mut ports_of: Vec<Vec<usize>> = vec![Vec::new(); nodes.id.len()];
    for (port, &owner) in nodes.ports.node.iter().enumerate() {
        match ports_of.get_mut(owner as usize) {
            Some(list) => list.push(port),
            None => orphan_port_issues(graph, port, issues),
        }
    }
    let mut by_id: PortsByNode<'a> = BTreeMap::new();
    for (index, id) in nodes.id.iter().enumerate() {
        if by_id.contains_key(id.as_str()) {
            issue(issues, IssueCode::DuplicateId, id);
        }
        let (width, height) = (nodes.width[index], nodes.height[index]);
        if !is_size(width) || !is_size(height) {
            issue(issues, IssueCode::BadSize, id);
        }
        let mut ids = BTreeSet::new();
        for &port in &ports_of[index] {
            let port_id = nodes.ports.id[port].as_str();
            let subject = format!("{id}.{port_id}");
            if ids.contains(port_id) {
                issue(issues, IssueCode::DuplicateId, &subject);
            }
            ids.insert(port_id);
            port_issues(graph, port, width, height, &subject, issues);
        }
        by_id.insert(id.as_str(), ids);
    }
    by_id
}

/// A port names a side, and an offset within that side of its node.
fn port_issues(
    graph: &Graph,
    port: usize,
    width: f64,
    height: f64,
    subject: &str,
    issues: &mut Vec<InputIssue>,
) {
    let Some(side) = Side::from_name(&graph.nodes.ports.side[port]) else {
        issue(issues, IssueCode::BadSide, subject);
        return;
    };
    let extent = match side {
        Side::North | Side::South => width,
        Side::East | Side::West => height,
    };
    let offset = graph.nodes.ports.offset[port];
    if !(offset >= 0.0 && offset <= extent) {
        issue(issues, IssueCode::BadOffset, subject);
    }
}

/// A port whose node index names no node. It has no width or height to check its offset against, so it is reported as
/// an unknown node, with its side checked and its offset checked for `NaN` and a negative value. The subject is
/// `#<index>.<port>`, since there is no node id to give. A `validate.ts` port always has its node, so nothing in
/// TypeScript corresponds to this report beyond the codes it uses.
fn orphan_port_issues(graph: &Graph, port: usize, issues: &mut Vec<InputIssue>) {
    let ports = &graph.nodes.ports;
    let subject = format!("#{}.{}", ports.node[port], ports.id[port]);
    issue(issues, IssueCode::UnknownNode, &subject);
    if Side::from_name(&ports.side[port]).is_none() {
        issue(issues, IssueCode::BadSide, &subject);
    }
    let offset = ports.offset[port];
    if offset.is_nan() || offset < 0.0 {
        issue(issues, IssueCode::BadOffset, &subject);
    }
}

/// Whether following `parent` from `start` comes back to a cluster already passed.
fn in_cycle(start: &str, parent_of: &BTreeMap<&str, Option<&str>>) -> bool {
    let mut passed = BTreeSet::new();
    let mut at = Some(start);
    while let Some(name) = at {
        if !passed.insert(name) {
            return true;
        }
        at = parent_of.get(name).copied().flatten();
    }
    false
}

fn cluster_issues(graph: &Graph, issues: &mut Vec<InputIssue>) {
    let clusters = &graph.clusters;
    // Ids in first-seen order; a repeated id keeps its place and takes the later record, as a `Map` does.
    let mut order: Vec<&str> = Vec::new();
    let mut parent_of: BTreeMap<&str, Option<&str>> = BTreeMap::new();
    for (index, id) in clusters.id.iter().enumerate() {
        if parent_of.contains_key(id.as_str()) {
            issue(issues, IssueCode::DuplicateId, id);
        } else {
            order.push(id.as_str());
        }
        parent_of.insert(id.as_str(), clusters.parent[index].as_deref());
    }
    for &id in &order {
        let parent = parent_of[id];
        if parent.is_some_and(|name| !parent_of.contains_key(name)) {
            issue(issues, IssueCode::UnknownCluster, id);
        }
        if in_cycle(id, &parent_of) {
            issue(issues, IssueCode::ClusterCycle, id);
        }
    }
    for (index, id) in graph.nodes.id.iter().enumerate() {
        if let Some(cluster) = &graph.nodes.cluster[index]
            && !parent_of.contains_key(cluster.as_str())
        {
            issue(issues, IssueCode::UnknownCluster, id);
        }
    }
}

/// The default sides of each kind, when set, must be sides.
fn kind_issues(kinds: &BTreeMap<String, EdgeKindPolicy>, issues: &mut Vec<InputIssue>) {
    for (kind, policy) in kinds {
        for side in [&policy.source_side, &policy.target_side]
            .into_iter()
            .flatten()
        {
            if Side::from_name(side).is_none() {
                issue(issues, IssueCode::BadSide, kind);
            }
        }
    }
}

fn edge_issues(
    graph: &Graph,
    kinds: &BTreeMap<String, EdgeKindPolicy>,
    nodes: &PortsByNode<'_>,
    issues: &mut Vec<InputIssue>,
) {
    let edges = &graph.edges;
    let mut seen = BTreeSet::new();
    for index in 0..edges.id.len() {
        let id = edges.id[index].as_str();
        if !seen.insert(id) {
            issue(issues, IssueCode::DuplicateId, id);
        }
        if !kinds.contains_key(&edges.kind[index]) {
            issue(issues, IssueCode::UnknownKind, id);
        }
        let ends = [
            (&edges.source[index], &edges.source_port[index]),
            (&edges.target[index], &edges.target_port[index]),
        ];
        for (end, port) in ends {
            match nodes.get(end.as_str()) {
                None => issue(issues, IssueCode::UnknownNode, id),
                Some(ports) => {
                    if let Some(port) = port
                        && !ports.contains(port.as_str())
                    {
                        issue(issues, IssueCode::UnknownPort, id);
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Clusters, EdgeKindPolicy, Edges, Nodes, Ports};

    /// The kinds of `validate.test.ts`: a ranking `dependency` and a non-ranking `relationship`.
    fn options() -> Options {
        let mut edge_kinds = BTreeMap::new();
        edge_kinds.insert(
            "dependency".to_owned(),
            EdgeKindPolicy {
                ranks: true,
                ..EdgeKindPolicy::default()
            },
        );
        edge_kinds.insert(
            "relationship".to_owned(),
            EdgeKindPolicy {
                weight: Some(0.3),
                ..EdgeKindPolicy::default()
            },
        );
        Options {
            edge_kinds,
            ..Options::default()
        }
    }

    fn node(graph: &mut Graph, id: &str, width: f64, height: f64, cluster: Option<&str>) {
        graph.nodes.id.push(id.to_owned());
        graph.nodes.width.push(width);
        graph.nodes.height.push(height);
        graph.nodes.cluster.push(cluster.map(str::to_owned));
        graph.nodes.partition.push(None);
    }

    fn port(graph: &mut Graph, owner: u32, id: &str, side: &str, offset: f64) {
        graph.nodes.ports.node.push(owner);
        graph.nodes.ports.id.push(id.to_owned());
        graph.nodes.ports.side.push(side.to_owned());
        graph.nodes.ports.offset.push(offset);
    }

    fn edge(graph: &mut Graph, id: &str, source: &str, target: &str, kind: &str) {
        graph.edges.id.push(id.to_owned());
        graph.edges.source.push(source.to_owned());
        graph.edges.target.push(target.to_owned());
        graph.edges.source_port.push(None);
        graph.edges.target_port.push(None);
        graph.edges.kind.push(kind.to_owned());
    }

    fn cluster(graph: &mut Graph, id: &str, parent: Option<&str>) {
        graph.clusters.id.push(id.to_owned());
        graph.clusters.parent.push(parent.map(str::to_owned));
        graph.clusters.padding.push(None);
        graph.clusters.label_height.push(None);
        graph.clusters.opaque.push(None);
    }

    /// Every issue as `code:subject`, sorted, as the TypeScript tests compare them.
    fn issues_of(graph: &Graph, options: &Options) -> Vec<String> {
        let mut found: Vec<String> = match validate(graph, options) {
            Ok(()) => Vec::new(),
            Err(error) => error
                .issues()
                .iter()
                .map(|found| format!("{}:{}", found.code.as_str(), found.subject))
                .collect(),
        };
        found.sort();
        found
    }

    fn sorted(list: &[&str]) -> Vec<String> {
        let mut out: Vec<String> = list.iter().map(|item| (*item).to_owned()).collect();
        out.sort();
        out
    }

    #[test]
    fn accepts_a_graph_with_ports_clusters_and_both_edge_kinds() {
        let mut graph = Graph::default();
        node(&mut graph, "a", 200.0, 60.0, None);
        node(&mut graph, "b", 200.0, 60.0, Some("g"));
        port(&mut graph, 0, "c1", "east", 30.0);
        cluster(&mut graph, "g", None);
        graph.edges = Edges::default();
        edge(&mut graph, "e1", "a", "b", "dependency");
        graph.edges.source_port[0] = Some("c1".to_owned());
        edge(&mut graph, "e2", "b", "a", "relationship");
        assert_eq!(validate(&graph, &options()), Ok(()));
    }

    #[test]
    fn reports_every_issue_at_once() {
        let mut graph = Graph::default();
        node(&mut graph, "a", 200.0, 60.0, None);
        node(&mut graph, "a", 200.0, 60.0, None);
        node(&mut graph, "z", 0.0, 60.0, Some("nope"));
        edge(&mut graph, "e", "a", "missing", "dependency");
        edge(&mut graph, "e", "a", "z", "other");
        graph.edges.source_port[1] = Some("p".to_owned());
        cluster(&mut graph, "x", Some("y"));
        cluster(&mut graph, "y", Some("x"));
        assert_eq!(
            issues_of(&graph, &options()),
            sorted(&[
                "bad-size:z",
                "cluster-cycle:x",
                "cluster-cycle:y",
                "duplicate-id:a",
                "duplicate-id:e",
                "unknown-cluster:z",
                "unknown-kind:e",
                "unknown-node:e",
                "unknown-port:e",
            ]),
        );
    }

    #[test]
    fn reports_a_port_side_that_is_not_a_side_and_an_offset_outside_its_side() {
        let mut graph = Graph::default();
        node(&mut graph, "a", 200.0, 60.0, None);
        port(&mut graph, 0, "up", "up", 10.0);
        port(&mut graph, 0, "low", "east", 61.0);
        port(&mut graph, 0, "neg", "north", -1.0);
        port(&mut graph, 0, "far", "north", 200.0);
        assert_eq!(
            issues_of(&graph, &options()),
            sorted(&["bad-side:a.up", "bad-offset:a.low", "bad-offset:a.neg"]),
        );
    }

    #[test]
    fn reports_a_port_whose_node_is_out_of_range_with_its_side_and_offset() {
        let mut graph = Graph::default();
        node(&mut graph, "a", 200.0, 60.0, None);
        port(&mut graph, 3, "ok", "north", 10.0);
        port(&mut graph, 3, "up", "up", 10.0);
        port(&mut graph, 4, "nan", "east", f64::NAN);
        port(&mut graph, 4, "neg", "west", -1.0);
        assert_eq!(
            issues_of(&graph, &options()),
            sorted(&[
                "unknown-node:#3.ok",
                "unknown-node:#3.up",
                "bad-side:#3.up",
                "unknown-node:#4.nan",
                "bad-offset:#4.nan",
                "unknown-node:#4.neg",
                "bad-offset:#4.neg",
            ]),
        );
    }

    #[test]
    fn reports_a_kind_whose_default_side_is_not_a_side() {
        let mut graph = Graph::default();
        node(&mut graph, "a", 200.0, 60.0, None);
        let mut kinds = options();
        kinds.edge_kinds.insert(
            "column".to_owned(),
            EdgeKindPolicy {
                source_side: Some("right".to_owned()),
                ..EdgeKindPolicy::default()
            },
        );
        kinds.edge_kinds.insert(
            "dependency".to_owned(),
            EdgeKindPolicy {
                ranks: true,
                target_side: Some("west".to_owned()),
                ..EdgeKindPolicy::default()
            },
        );
        assert_eq!(issues_of(&graph, &kinds), sorted(&["bad-side:column"]));
    }

    #[test]
    fn accepts_an_edge_whose_kind_sets_its_own_default_sides() {
        let mut graph = Graph::default();
        node(&mut graph, "a", 200.0, 60.0, None);
        node(&mut graph, "b", 200.0, 60.0, None);
        edge(&mut graph, "e", "a", "b", "column");
        let mut kinds = Options::default();
        kinds.edge_kinds.insert(
            "column".to_owned(),
            EdgeKindPolicy {
                source_side: Some("south".to_owned()),
                target_side: Some("north".to_owned()),
                ..EdgeKindPolicy::default()
            },
        );
        assert_eq!(validate(&graph, &kinds), Ok(()));
    }

    #[test]
    fn accepts_any_graph_whose_edges_join_known_nodes_by_a_known_kind() {
        // A fixed sweep over sizes and edge lists, standing in for the property test of validate.test.ts.
        let mut state: u64 = 0x9e37_79b9_7f4a_7c15;
        let mut next = move |bound: u64| {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            (state >> 33) % bound
        };
        for count in 1..=30_u64 {
            let mut graph = Graph::default();
            for index in 0..count {
                node(&mut graph, &format!("n{index}"), 200.0, 60.0, None);
            }
            let pairs = next(60);
            for index in 0..pairs {
                let source = next(count);
                let target = next(count);
                let kind = if next(2) == 0 {
                    "dependency"
                } else {
                    "relationship"
                };
                edge(
                    &mut graph,
                    &format!("e{index}"),
                    &format!("n{source}"),
                    &format!("n{target}"),
                    kind,
                );
            }
            assert_eq!(validate(&graph, &options()), Ok(()), "count {count}");
        }
    }

    #[test]
    fn rejects_non_finite_sizes_and_offsets() {
        let mut graph = Graph::default();
        node(&mut graph, "nan", f64::NAN, 60.0, None);
        node(&mut graph, "inf", 200.0, f64::INFINITY, None);
        node(&mut graph, "a", 200.0, 60.0, None);
        port(&mut graph, 2, "nan", "north", f64::NAN);
        port(&mut graph, 2, "inf", "east", f64::INFINITY);
        assert_eq!(
            issues_of(&graph, &options()),
            sorted(&[
                "bad-offset:a.inf",
                "bad-offset:a.nan",
                "bad-size:inf",
                "bad-size:nan",
            ]),
        );
    }

    #[test]
    fn rejects_a_cluster_that_is_its_own_parent_and_a_node_in_an_unknown_one() {
        let mut graph = Graph::default();
        node(&mut graph, "a", 200.0, 60.0, Some("ghost"));
        cluster(&mut graph, "self", Some("self"));
        assert_eq!(
            issues_of(&graph, &options()),
            sorted(&["cluster-cycle:self", "unknown-cluster:a"]),
        );
    }

    #[test]
    fn accepts_a_self_loop_as_the_layout_does_and_refuses_an_unknown_port_on_it() {
        let mut graph = Graph::default();
        node(&mut graph, "a", 200.0, 60.0, None);
        edge(&mut graph, "loop", "a", "a", "dependency");
        assert_eq!(validate(&graph, &options()), Ok(()));
        graph.edges.target_port[0] = Some("nowhere".to_owned());
        assert_eq!(
            issues_of(&graph, &options()),
            sorted(&["unknown-port:loop"])
        );
    }

    #[test]
    fn a_later_node_with_a_repeated_id_replaces_the_earlier_ports() {
        // As in validate.ts, the port set of a repeated node id is the later node's, so an edge to the earlier port
        // is refused and one to the later port is not.
        let mut graph = Graph::default();
        node(&mut graph, "a", 200.0, 60.0, None);
        port(&mut graph, 0, "p", "north", 0.0);
        node(&mut graph, "a", 200.0, 60.0, None);
        port(&mut graph, 1, "q", "north", 0.0);
        edge(&mut graph, "e", "a", "a", "dependency");
        graph.edges.source_port[0] = Some("q".to_owned());
        graph.edges.target_port[0] = Some("p".to_owned());
        assert_eq!(
            issues_of(&graph, &options()),
            sorted(&["duplicate-id:a", "unknown-port:e"]),
        );
    }

    #[test]
    fn error_display_names_each_issue() {
        let mut graph = Graph::default();
        node(&mut graph, "a", 0.0, 60.0, None);
        let error = validate(&graph, &options()).expect_err("bad size");
        assert_eq!(
            error.to_string(),
            "invalid graph input (1 issues); bad-size a"
        );
    }

    #[test]
    fn empty_model_collections_are_valid() {
        let graph = Graph {
            nodes: Nodes {
                ports: Ports::default(),
                ..Nodes::default()
            },
            edges: Edges::default(),
            clusters: Clusters::default(),
        };
        assert_eq!(validate(&graph, &Options::default()), Ok(()));
    }
}
