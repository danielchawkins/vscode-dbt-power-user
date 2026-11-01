//! S5: a `Projector` that has solved a problem allocates nothing when it re-solves the same constraints with new desired
//! positions, and ranking and layering allocate nothing once their scratch has warmed up. An `Engine` relayout that
//! re-runs placement and routing allocates a bounded amount that does not grow (S5, Phase 7; zero is not the target, see
//! Phase 8 in the plan). `solve` is `pub(crate)`, so this test includes its source with a path attribute; `solve`
//! imports nothing from the crate (ADR 0011). Layering reaches `budget`, `index` and `model`, so those are included too.
//! The counting allocator needs an `unsafe impl GlobalAlloc`, which the core forbids; this integration test is its own
//! crate and the one place that allows it.

#![expect(
    unsafe_code,
    dead_code,
    unused_imports,
    unreachable_pub,
    reason = "this crate includes whole library modules and uses part of them; the counting allocator needs an unsafe impl, which the core forbids and this crate does not"
)]

#[path = "../src/solve/mod.rs"]
#[expect(
    dead_code,
    reason = "the included solver exposes items this test does not call; the crate's own tests call them"
)]
mod solve;

#[path = "../src/budget/mod.rs"]
mod budget;

#[path = "../src/index/mod.rs"]
mod index;

#[path = "../src/model/mod.rs"]
mod model;

/// The crate's `testkit::frame_fixture`, which the included `model` names from its unit tests (`model/frame.rs`). The
/// crate's `testkit` also holds oracles that need `route`, which this binary does not include, so only the fixture
/// reader is repeated here, over the same fixture file.
mod testkit {
    const FRAMES: &str = include_str!("../fixtures/parity/frame.txt");

    pub(crate) fn frame_fixture(kind: &str) -> Vec<u8> {
        let prefix = format!("frame {kind} ");
        let line = FRAMES
            .lines()
            .find_map(|line| line.strip_prefix(prefix.as_str()))
            .expect("the fixture holds the frame");
        line.as_bytes()
            .chunks(2)
            .map(|pair| {
                let digits = std::str::from_utf8(pair).expect("hex digits are ASCII");
                u8::from_str_radix(digits, 16).expect("a byte of hex")
            })
            .collect()
    }
}

#[path = "../src/layering/mod.rs"]
mod layering;

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::collections::BTreeMap;

use budget::Budget;
use graph_layout::engine::{Engine, Generation, Progress, Stage};
use graph_layout::model::{
    Clusters, EdgeKindPolicy, Edges, Graph, Nodes, Options, PartialSpacing, Ports,
};
use index::Indexed;
use layering::{
    EdgeRule, Layers, PartitionMode, RankOptions, Ranks, Scratch, layer_into, rank_into,
};
use solve::{Problem, Projector, Separation};

thread_local! {
    /// Allocations made by this thread. Thread-local, so the test harness's other threads do not count.
    static ALLOCATIONS: Cell<usize> = const { Cell::new(0) };
}

struct Counting;

fn count() {
    // `try_with`: during thread teardown the slot may already be gone, and then nothing is being measured.
    let _ = ALLOCATIONS.try_with(|count| count.set(count.get() + 1));
}

// SAFETY: every method forwards to `System` with the layout and pointer it was given, and only counts the call.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        count();
        // SAFETY: the caller guarantees `layout` has a non-zero size, as `GlobalAlloc::alloc` requires; it is forwarded.
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        // SAFETY: `ptr` was returned by this allocator with `layout`, as `GlobalAlloc::dealloc` requires; it is forwarded.
        unsafe { System.dealloc(ptr, layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        count();
        // SAFETY: `ptr` and `layout` describe a live allocation of this allocator, as `GlobalAlloc::realloc` requires.
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static GLOBAL: Counting = Counting;

/// The allocations `f` makes on this thread.
fn allocations_during(f: impl FnOnce()) -> usize {
    let before = ALLOCATIONS.with(Cell::get);
    f();
    ALLOCATIONS.with(Cell::get) - before
}

/// Targets from a linear congruential generator: `count` vectors of `n` values in [-5, 5). The generator is fixed, so
/// the sequence is the same on every run.
fn targets(n: usize, count: usize) -> Vec<Vec<f64>> {
    let mut state: u64 = 0x2545_f491_4f6c_dd1d;
    (0..count)
        .map(|_| {
            (0..n)
                .map(|_| {
                    state = state
                        .wrapping_mul(6_364_136_223_846_793_005)
                        .wrapping_add(1_442_695_040_888_963_407);
                    let draw = u32::try_from(state >> 32).unwrap_or(0);
                    f64::from(draw) / 4_294_967_296.0 * 10.0 - 5.0
                })
                .collect()
        })
        .collect()
}

/// Warms a projector on the first target, then re-solves every later target with the same constraints, counting the
/// allocations of each re-solve.
fn assert_steady_state(name: &str, separations: &[Separation], targets: &[Vec<f64>]) {
    let weight = vec![1.0; targets[0].len()];
    let mut projector = Projector::new();
    projector
        .solve(&Problem {
            x0: &targets[0],
            weight: &weight,
            separations,
        })
        .unwrap_or_else(|e| panic!("{name}: warm-up: {e}"));
    for (index, x0) in targets.iter().enumerate().skip(1) {
        let allocated = allocations_during(|| {
            projector
                .solve(&Problem {
                    x0,
                    weight: &weight,
                    separations,
                })
                .unwrap_or_else(|e| panic!("{name}: target {index}: {e}"));
        });
        assert_eq!(
            allocated, 0,
            "{name}: re-solve {index} allocated after warm-up"
        );
    }
}

/// The reviewer's case: nothing merges on the warm-up, so the buffers that merging fills never grew, and the next solve
/// of the same constraints merges.
#[test]
fn a_solve_that_merges_nothing_leaves_its_scratch_ready() {
    let separations = [Separation {
        from: 0,
        to: 1,
        gap: 1.0,
    }];
    assert_steady_state(
        "two variables, gap 1",
        &separations,
        &[vec![0.0, 5.0], vec![0.0, 0.0], vec![3.0, 3.0]],
    );
}

/// A merging chain of 24 variables with unit gaps, re-solved on 50 targets.
#[test]
fn a_merging_chain_re_solves_without_allocating() {
    let separations: Vec<Separation> = (1..24)
        .map(|k| Separation {
            from: u32::try_from(k - 1).unwrap_or(0),
            to: u32::try_from(k).unwrap_or(0),
            gap: 1.0,
        })
        .collect();
    assert_steady_state("chain of 24", &separations, &targets(24, 50));
}

/// Two blocks that close a cycle of blocks, so a split releases a negative multiplier, re-solved on 50 targets.
#[test]
fn a_split_re_solves_without_allocating() {
    let separations = [
        Separation {
            from: 0,
            to: 1,
            gap: 1.0,
        },
        Separation {
            from: 2,
            to: 3,
            gap: 1.0,
        },
        Separation {
            from: 0,
            to: 3,
            gap: 0.5,
        },
        Separation {
            from: 2,
            to: 1,
            gap: 0.5,
        },
    ];
    assert_steady_state("crossing blocks", &separations, &targets(4, 50));
}

/// The inputs of a layering run: the graph, the rule of each edge, and the band and hint of each node.
struct LayeringWorkload {
    graph: Indexed,
    rules: Vec<EdgeRule>,
    partitions: Vec<Option<f64>>,
    hints: Vec<Option<u32>>,
}

/// A graph of 60 nodes and 180 edges, fixed by the generator. Most edges point forward, a tenth point back and close
/// cycles, one in fifty has unknown ends, and the kinds are two that rank and one that does not. A quarter of the nodes
/// have no partition band, and every seventh node is hinted.
fn layering_workload() -> LayeringWorkload {
    const NODES: usize = 60;
    const EDGES: usize = 180;
    let mut state: u64 = 0x9e37_79b9_7f4a_7c15;
    let mut draw = |bound: usize| -> usize {
        state = state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        usize::try_from((state >> 33) % u64::try_from(bound).unwrap_or(1)).unwrap_or(0)
    };
    let mut ends = Vec::with_capacity(EDGES);
    let mut rules = Vec::with_capacity(EDGES);
    for _ in 0..EDGES {
        let a = draw(NODES);
        let mut b = draw(NODES - 1);
        if b >= a {
            b += 1;
        }
        let (from, to) = if draw(10) == 0 { (b, a) } else { (a, b) };
        ends.push(if draw(50) == 0 {
            None
        } else {
            Some((
                u32::try_from(from).unwrap_or(0),
                u32::try_from(to).unwrap_or(0),
            ))
        });
        let kind = draw(3);
        rules.push(match kind {
            0 => EdgeRule {
                kind,
                ranks: true,
                min_length: 1.0,
                weight: 1.0,
                ports: [None, None],
            },
            1 => EdgeRule {
                kind,
                ranks: true,
                min_length: 2.0,
                weight: 3.0,
                ports: [None, None],
            },
            _ => EdgeRule {
                kind,
                ranks: false,
                min_length: 1.0,
                weight: 1.0,
                ports: [None, None],
            },
        });
    }
    let partitions = (0..NODES)
        .map(|node| (node % 4 != 0).then(|| f64::from(u32::try_from(node % 3).unwrap_or(0))))
        .collect();
    let hints = (0..NODES)
        .map(|node| (node % 7 == 0).then(|| u32::try_from(node / 7).unwrap_or(0)))
        .collect();
    LayeringWorkload {
        graph: Indexed::from_ends(NODES, ends, &[true; EDGES]),
        rules,
        partitions,
        hints,
    }
}

/// Ranking and layering, run twice on the same input under each partition mode. The second call of each must allocate
/// nothing, and must give the same output as the first.
#[test]
fn ranking_and_layering_re_run_without_allocating() {
    let LayeringWorkload {
        graph,
        rules,
        partitions,
        hints,
    } = layering_workload();
    let budget = Budget::for_effort(None).expect("the balanced budget exists");
    let mut scratch = Scratch::default();
    let mut ranks = Ranks::default();
    let mut layers = Layers::default();
    for mode in [
        PartitionMode::None,
        PartitionMode::Soft,
        PartitionMode::Strict,
    ] {
        let options = RankOptions {
            partitions: mode,
            node_partition: &partitions,
            edges: &rules,
            hints: &hints,
            stability: 1.0,
            budget: &budget,
        };
        rank_into(&graph, &options, &mut scratch, &mut ranks)
            .unwrap_or_else(|e| panic!("{mode:?}: first rank: {e:?}"));
        layer_into(&graph, &rules, &ranks.ranks, &mut scratch, &mut layers);
        let (first_ranks, first_layers) = (ranks.clone(), layers.clone());

        let rank_allocs = allocations_during(|| {
            rank_into(&graph, &options, &mut scratch, &mut ranks)
                .unwrap_or_else(|e| panic!("{mode:?}: second rank: {e:?}"));
        });
        assert_eq!(
            rank_allocs, 0,
            "{mode:?}: rank allocated on its second call"
        );
        assert_eq!(
            ranks, first_ranks,
            "{mode:?}: second rank differs from the first"
        );

        let layer_allocs = allocations_during(|| {
            layer_into(&graph, &rules, &ranks.ranks, &mut scratch, &mut layers);
        });
        assert_eq!(
            layer_allocs, 0,
            "{mode:?}: layer allocated on its second call"
        );
        assert_eq!(
            layers, first_layers,
            "{mode:?}: second layer differs from the first"
        );
    }
}

fn number(n: usize) -> f64 {
    f64::from(u32::try_from(n).unwrap_or(0))
}

/// A graph of 60 nodes and 150 edges, fixed by the generator. Nodes are 40 to 60 wide and 20 to 40 high. A quarter of the
/// edges are `info` (routed, not ranked, and either way round); the rest are `rank` edges that point forward, so they
/// cannot close a cycle.
fn engine_graph() -> Graph {
    const NODES: usize = 60;
    const EDGES: usize = 150;
    let mut state: u64 = 0x6a09_e667_f3bc_c908;
    let mut draw = |bound: usize| -> usize {
        state = state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        usize::try_from((state >> 33) % u64::try_from(bound).unwrap_or(1)).unwrap_or(0)
    };
    let width: Vec<f64> = (0..NODES).map(|_| 40.0 + 5.0 * number(draw(5))).collect();
    let height: Vec<f64> = (0..NODES).map(|_| 20.0 + 5.0 * number(draw(5))).collect();
    let mut source = Vec::with_capacity(EDGES);
    let mut target = Vec::with_capacity(EDGES);
    let mut kind = Vec::with_capacity(EDGES);
    for _ in 0..EDGES {
        let a = draw(NODES);
        let mut b = draw(NODES - 1);
        if b >= a {
            b += 1;
        }
        let info = draw(4) == 0;
        let (from, to) = if info { (a, b) } else { (a.min(b), a.max(b)) };
        source.push(format!("n{from}"));
        target.push(format!("n{to}"));
        kind.push(if info { "info" } else { "rank" }.to_owned());
    }
    Graph {
        nodes: Nodes {
            id: (0..NODES).map(|node| format!("n{node}")).collect(),
            width,
            height,
            cluster: vec![None; NODES],
            partition: vec![None; NODES],
            ports: Ports::default(),
        },
        edges: Edges {
            id: (0..EDGES).map(|edge| format!("e{edge}")).collect(),
            source,
            target,
            source_port: vec![None; EDGES],
            target_port: vec![None; EDGES],
            kind,
        },
        clusters: Clusters::default(),
    }
}

/// The options of the engine test: `balanced`, the `rank` kind ranks, the `info` kind is routed, and `spacing.node` is
/// `node`. Only placement reads `spacing.node`, so a change of it re-runs placement and routing and nothing else.
fn engine_options(node: f64) -> Options {
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
        spacing: Some(PartialSpacing {
            node: Some(node),
            ..PartialSpacing::default()
        }),
        effort: Some("balanced".to_owned()),
        ..Options::default()
    }
}

/// The request of `generation` on `engine`, run to the end, with the allocations the request made.
fn request(
    engine: &Engine,
    graph: &Graph,
    options: &Options,
    generation: u64,
) -> (Progress, usize) {
    let mut progress = None;
    let allocated = allocations_during(|| {
        progress = Some(
            engine
                .layout(graph, options, Generation::new(generation))
                .expect("the options are valid")
                .expect("no newer generation has started"),
        );
    });
    (progress.expect("the request ran"), allocated)
}

/// The most a placement-only relayout of `engine_graph` may allocate. Measured when the test was written, on this test's
/// own graph (60 nodes, 150 edges, `balanced`): the warm-up made 7,254 allocations, and the 20 relayouts after it made
/// 7,234 or 7,254, so none grew. The limit is about 10% above the measured 7,254.
const RELAYOUT_LIMIT: usize = 7_980;

/// S5 (Phase 7): after a full layout, one warm-up `spacing.node` relayout and then 20 more with `spacing.node`
/// alternating, every one re-running placement and routing. No relayout after the warm-up allocates more than the warm-up
/// did, each is under `RELAYOUT_LIMIT`, and an unchanged request, which re-runs no stage, allocates fewer than a
/// placement-only relayout.
#[test]
fn an_engine_relayout_after_warm_up_allocates_a_bounded_amount_that_does_not_grow() {
    let graph = engine_graph();
    let engine = Engine::new();
    let (first, _) = request(&engine, &graph, &engine_options(28.0), 1);
    assert_eq!(
        first.reran(),
        Stage::ALL.as_slice(),
        "a fresh engine runs every stage"
    );

    let placed = [Stage::Place, Stage::Route];
    let (warm, warm_allocs) = request(&engine, &graph, &engine_options(30.0), 2);
    assert_eq!(
        warm.reran(),
        placed.as_slice(),
        "the warm-up re-runs placement and routing"
    );
    assert!(
        warm_allocs < RELAYOUT_LIMIT,
        "warm-up: {warm_allocs} allocations, limit {RELAYOUT_LIMIT}"
    );

    let mut last = engine_options(30.0);
    for generation in 3..=22 {
        let options = engine_options(if generation % 2 == 1 { 28.0 } else { 30.0 });
        let (progress, allocs) = request(&engine, &graph, &options, generation);
        assert_eq!(
            progress.reran(),
            placed.as_slice(),
            "relayout {generation} re-runs other stages"
        );
        assert!(
            allocs <= warm_allocs,
            "relayout {generation} allocated {allocs}, more than the warm-up's {warm_allocs}"
        );
        assert!(
            allocs < RELAYOUT_LIMIT,
            "relayout {generation}: {allocs} allocations, limit {RELAYOUT_LIMIT}"
        );
        last = options;
    }

    let (unchanged, unchanged_allocs) = request(&engine, &graph, &last, 23);
    assert_eq!(
        unchanged.reran(),
        &[] as &[Stage],
        "an unchanged request re-runs no stage"
    );
    assert!(
        unchanged_allocs < warm_allocs,
        "an unchanged request allocated {unchanged_allocs}, not fewer than the placement-only relayout's {warm_allocs}"
    );
}
