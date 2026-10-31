//! Unit tests of the routes on hand-built inputs: the tracks of overlapping runs, the drawn and refused edges, the levels
//! runs, and the opaque gate. The properties on random graphs, through the phases, are in `engine/phases/tests.rs`.

use super::{
    ClusterBox, ClusterInput, EdgeInput, EdgeRoute, NodeInput, Point, Rect, RouteInput, Stop,
    route, route_levels, same_coordinate,
};

/// A node of `rank` centred at `along`, with half-extent `half`, held by no box.
fn node(rank: usize, along: f64) -> NodeInput {
    NodeInput {
        rank,
        along,
        across: 0.0,
        half: 5.0,
        holders: Vec::new(),
    }
}

/// A stop of an edge at `rank` and `along`, at a real end of half-extent 5.
fn stop(rank: usize, along: f64) -> Stop {
    Stop {
        rank,
        along,
        across: 0.0,
        half: 5.0,
    }
}

/// A node of `rank` centred at `along` and `across` under levels, with half-extent `half`, held by no box.
fn solved(rank: usize, along: f64, across: f64, half: f64) -> NodeInput {
    NodeInput {
        rank,
        along,
        across,
        half,
        holders: Vec::new(),
    }
}

/// A stop of an edge at a real end of `rank`, centred at `along` and `across`, with half-extent `half`.
fn solved_stop(rank: usize, along: f64, across: f64, half: f64) -> Stop {
    Stop {
        rank,
        along,
        across,
        half,
    }
}

/// A point of the drawing, from its coordinates.
fn at(x: f64, y: f64) -> Point {
    Point { x, y }
}

/// An edge between two real nodes that is routed, with the given stops.
fn edge(source: usize, target: usize, stops: Vec<Stop>) -> EdgeInput {
    EdgeInput {
        routed: true,
        source,
        target,
        stops,
    }
}

/// A two-rank drawing going down, with the given nodes, edges and clusters, and no margins.
fn input(nodes: Vec<NodeInput>, edges: Vec<EdgeInput>, clusters: Vec<ClusterInput>) -> RouteInput {
    RouteInput {
        down: true,
        edge_gap: 4.0,
        rank_gap: 28.0,
        ranks: 2,
        below: vec![0.0; 2],
        above: vec![0.0; 2],
        anchor_rank: None,
        nodes,
        clusters,
        edges,
    }
}

/// The points of a drawn edge, or a panic naming the variant it is.
fn points(route: &EdgeRoute) -> &[Point] {
    match route {
        EdgeRoute::Routed(points) => points,
        other => panic!("expected a drawn edge, found {other:?}"),
    }
}

/// Every segment of `points` is horizontal or vertical.
fn is_orthogonal(points: &[Point]) -> bool {
    points
        .windows(2)
        .all(|pair| same_coordinate(pair[0].x, pair[1].x) || same_coordinate(pair[0].y, pair[1].y))
}

#[test]
fn overlapping_runs_take_separate_tracks() {
    // Two edges cross the same band with horizontal pieces that overlap, so each takes a track of its own.
    let nodes = vec![node(0, 0.0), node(0, 100.0), node(1, 0.0), node(1, 100.0)];
    let edges = vec![
        edge(0, 3, vec![stop(0, 0.0), stop(1, 100.0)]),
        edge(1, 2, vec![stop(0, 100.0), stop(1, 0.0)]),
    ];
    let routing = route(&input(nodes, edges, Vec::new()));
    let first = points(&routing.edges[0]);
    let second = points(&routing.edges[1]);
    assert!(is_orthogonal(first) && is_orthogonal(second));
    assert_eq!((first[0].x, first[first.len() - 1].x), (0.0, 100.0));
    assert_eq!((second[0].x, second[second.len() - 1].x), (100.0, 0.0));
    let track = |points: &[Point]| points[points.len() / 2].y;
    assert_ne!(track(first), track(second), "overlapping runs keep apart");
    assert_eq!(routing.work.tracks, 2);
}

#[test]
fn self_loops_and_unrouted_kinds_are_not_drawn() {
    let nodes = vec![node(0, 0.0), node(1, 50.0)];
    let edges = vec![
        edge(0, 0, Vec::new()),
        EdgeInput {
            routed: false,
            ..edge(0, 1, vec![stop(0, 0.0), stop(1, 50.0)])
        },
    ];
    let routing = route(&input(nodes, edges, Vec::new()));
    assert_eq!(routing.edges[0], EdgeRoute::RouteFailed);
    assert_eq!(routing.edges[1], EdgeRoute::NotRouted);
}

#[test]
fn a_run_through_an_opaque_box_is_refused() {
    // The source sits outside the box and the target too; the run between them crosses the box between the ranks.
    let nodes = vec![node(0, -100.0), node(1, 100.0)];
    let edges = vec![edge(0, 1, vec![stop(0, -100.0), stop(1, 100.0)])];
    let boxed = |opaque: bool| ClusterInput {
        cluster: 0,
        left: -20.0,
        right: 20.0,
        top: 0,
        bottom: 1,
        padding: 0.0,
        label_height: 0.0,
        parent: None,
        opaque,
        across: None,
    };
    let refused = route(&input(nodes.clone(), edges.clone(), vec![boxed(true)]));
    assert_eq!(refused.edges[0], EdgeRoute::RouteFailed);
    assert_eq!(refused.work.opaque_failures, 1);
    let drawn = route(&input(nodes, edges, vec![boxed(false)]));
    assert!(matches!(drawn.edges[0], EdgeRoute::Routed(_)));
}

#[test]
fn a_levels_run_drops_from_the_upper_bottom_to_the_lower_top() {
    // The upper node's bottom is at 5 and the lower node's top at 45, so the run goes down to the middle of the gap, at 25.
    let nodes = vec![solved(0, 0.0, 0.0, 5.0), solved(1, 30.0, 50.0, 5.0)];
    let edges = vec![edge(
        0,
        1,
        vec![
            solved_stop(0, 0.0, 0.0, 5.0),
            solved_stop(1, 30.0, 50.0, 5.0),
        ],
    )];
    let routing = route_levels(&input(nodes, edges, Vec::new()));
    assert_eq!(routing.nodes, vec![at(0.0, 0.0), at(30.0, 50.0)]);
    assert_eq!(
        points(&routing.edges[0]),
        &[at(0.0, 5.0), at(0.0, 25.0), at(30.0, 25.0), at(30.0, 45.0)]
    );
}

#[test]
fn a_levels_run_between_overlapping_nodes_goes_beneath_both() {
    // The lower node's top (3) is above the upper node's bottom (5), so the run leaves both from the bottom and goes
    // beneath both: down to the gap's far side plus one edge spacing, at 17.
    let nodes = vec![solved(0, 0.0, 0.0, 5.0), solved(1, 30.0, 8.0, 5.0)];
    let edges = vec![edge(
        0,
        1,
        vec![
            solved_stop(0, 0.0, 0.0, 5.0),
            solved_stop(1, 30.0, 8.0, 5.0),
        ],
    )];
    let routing = route_levels(&input(nodes, edges, Vec::new()));
    assert_eq!(
        points(&routing.edges[0]),
        &[at(0.0, 5.0), at(0.0, 17.0), at(30.0, 17.0), at(30.0, 13.0)]
    );
}

#[test]
fn a_levels_run_from_a_lower_source_is_turned_round() {
    // The source is the lower end: the run is computed from the upper target and then read from the source end.
    let nodes = vec![solved(0, 0.0, 0.0, 5.0), solved(1, 30.0, 50.0, 5.0)];
    let edges = vec![edge(
        1,
        0,
        vec![
            solved_stop(1, 30.0, 50.0, 5.0),
            solved_stop(0, 0.0, 0.0, 5.0),
        ],
    )];
    let routing = route_levels(&input(nodes, edges, Vec::new()));
    assert_eq!(
        points(&routing.edges[0]),
        &[at(30.0, 45.0), at(30.0, 25.0), at(0.0, 25.0), at(0.0, 5.0)]
    );
}

#[test]
fn a_levels_run_through_an_opaque_box_is_refused_and_the_box_is_drawn_where_placement_solved_it() {
    // The run's horizontal piece at 25 crosses the box, which placement solved from 20 to 30 across and from -20 to 20
    // along, and which holds neither end.
    let nodes = vec![solved(0, 0.0, 0.0, 5.0), solved(1, 30.0, 50.0, 5.0)];
    let edges = vec![edge(
        0,
        1,
        vec![
            solved_stop(0, 0.0, 0.0, 5.0),
            solved_stop(1, 30.0, 50.0, 5.0),
        ],
    )];
    let boxed = |opaque: bool| ClusterInput {
        cluster: 0,
        left: -20.0,
        right: 20.0,
        top: 0,
        bottom: 1,
        padding: 0.0,
        label_height: 0.0,
        parent: None,
        opaque,
        across: Some((20.0, 30.0)),
    };
    let refused = route_levels(&input(nodes.clone(), edges.clone(), vec![boxed(true)]));
    assert_eq!(refused.edges[0], EdgeRoute::RouteFailed);
    assert_eq!(refused.work.opaque_failures, 1);
    assert_eq!(
        refused.clusters,
        vec![ClusterBox {
            cluster: 0,
            rect: Rect {
                x: -20.0,
                y: 20.0,
                width: 40.0,
                height: 10.0,
            },
        }]
    );
    let drawn = route_levels(&input(nodes, edges, vec![boxed(false)]));
    assert!(matches!(drawn.edges[0], EdgeRoute::Routed(_)));
}

#[test]
fn a_diagonal_step_through_an_opaque_box_is_a_breach() {
    // A step that is neither level nor plumb is not a segment of a route, but it must not pass the gate: it runs
    // through the box, so the box is breached.
    use super::opaque::breaches;
    let rect = Rect {
        x: 0.0,
        y: 0.0,
        width: 10.0,
        height: 10.0,
    };
    let through = [Point { x: -5.0, y: -5.0 }, Point { x: 15.0, y: 15.0 }];
    assert_eq!(breaches(&through, &[rect], &[true]), vec![0]);
    let beside = [Point { x: 50.0, y: -5.0 }, Point { x: 60.0, y: 15.0 }];
    assert_eq!(breaches(&beside, &[rect], &[true]), Vec::<usize>::new());
}
