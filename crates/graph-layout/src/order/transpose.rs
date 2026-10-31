//! Swaps neighbouring units in a rank while the swap lowers the crossings. A unit is a node with its lateral port
//! dummies, so it moves whole, and only units in the same innermost cluster swap. A port of `order/transpose.ts`.

use super::clusters::same_chain;
use super::crossings::group_crossings;
use super::model::{OrderModel, units_of};

/// Passes of transposition after a sweep. A pass that swaps nothing ends them earlier.
const TRANSPOSE_PASSES: usize = 4;

/// Transposes every rank until a pass swaps nothing, or `TRANSPOSE_PASSES` passes have run.
pub(crate) fn transpose(model: &mut OrderModel<'_>) {
    let graph = model.graph;
    let mut improved = true;
    let mut pass = 0;
    while improved && pass < TRANSPOSE_PASSES {
        improved = false;
        for rank in 0..model.layers.len() {
            let mut units = units_of(&model.layers[rank], &graph.block);
            for k in 0..units.len().saturating_sub(1) {
                let (a, b) = (&units[k], &units[k + 1]);
                let swap = same_chain(&graph.paths[a[0]], &graph.paths[b[0]])
                    && group_crossings(model, b, a) < group_crossings(model, a, b);
                if swap {
                    units.swap(k, k + 1);
                    model.set_layer(rank, units.concat());
                    improved = true;
                }
            }
        }
        pass += 1;
    }
}
