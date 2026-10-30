//! S5: a `Projector` that has solved a problem allocates nothing when it re-solves the same constraints with new desired
//! positions. `solve` is `pub(crate)`, so this test includes its source with a path attribute; `solve` imports nothing
//! from the crate (ADR 0011), so the included module compiles on its own. The counting allocator needs an
//! `unsafe impl GlobalAlloc`, which the core forbids; this integration test is its own crate and the one place that
//! allows it.

#![expect(
    unsafe_code,
    reason = "a counting global allocator needs an unsafe impl; the core forbids unsafe, this test crate does not"
)]

#[path = "../src/solve/mod.rs"]
#[expect(
    dead_code,
    reason = "the included solver exposes items this test does not call; the crate's own tests call them"
)]
mod solve;

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

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
