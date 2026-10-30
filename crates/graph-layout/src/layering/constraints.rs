//! Constraints that keep bands of nodes in order and pull nodes toward their hinted ranks. A port of
//! `packages/graph-layout/src/rank/constraints.ts`.

use super::PartitionMode;
use super::network::NetworkEdge;

/// Cost per rank a node of a higher band sits above its gate, under soft partitions.
const SOFT_PARTITION_WEIGHT: f64 = 1.0;

/// Weight that keeps each link of a hint's reference chain at exactly one rank.
const CHAIN_WEIGHT: f64 = 1000.0;

/// Extra network nodes and edges that a constraint adds to the ranking. Its nodes are numbered after the nodes it was
/// given, so the real nodes keep their indices.
pub(super) struct Extension {
    /// Node count after the extension: the nodes given, then the ones the constraint adds.
    pub(super) count: usize,
    pub(super) edges: Vec<NetworkEdge>,
}

/// Bands of nodes kept in order: each band lies in earlier ranks than the next. One gate node sits between each pair
/// of adjacent bands. Every node of a band is at or above its gate (weight 0, minimum length 0). A node whose band is
/// `None` is in none: no gate constrains it, so its edges alone rank it.
///
/// Under `Strict`, every node of the next band lies below its gate (minimum length 1). Under `Soft`, each such node gets
/// one mediator that costs `SOFT_PARTITION_WEIGHT` per rank the node sits above the gate. The mediator sits at the
/// larger of the node's rank and one more than the gate's rank, so the cost is the hinge `max(0, gate + 1 - rank)`.
pub(super) fn partition_constraints(partitions: &[Option<f64>], mode: PartitionMode) -> Extension {
    let mut bands: Vec<f64> = partitions.iter().flatten().copied().collect();
    bands.sort_by(f64::total_cmp);
    bands.dedup();
    let gate_of = |k: usize| partitions.len() + k;
    let mut count = partitions.len() + bands.len().saturating_sub(1);
    let mut edges = Vec::new();
    for (node, band) in partitions.iter().enumerate() {
        let Some(band) = *band else {
            continue;
        };
        let Some(k) = bands.iter().position(|&b| b.to_bits() == band.to_bits()) else {
            continue;
        };
        if k + 1 < bands.len() {
            edges.push(NetworkEdge {
                tail: node,
                head: gate_of(k),
                min_length: 0.0,
                weight: 0.0,
            });
        }
        if k == 0 {
            continue;
        }
        let gate = gate_of(k - 1);
        if mode == PartitionMode::Strict {
            edges.push(NetworkEdge {
                tail: gate,
                head: node,
                min_length: 1.0,
                weight: 0.0,
            });
            continue;
        }
        let mediator = count;
        count += 1;
        edges.push(NetworkEdge {
            tail: node,
            head: mediator,
            min_length: 0.0,
            weight: SOFT_PARTITION_WEIGHT,
        });
        edges.push(NetworkEdge {
            tail: gate,
            head: mediator,
            min_length: 1.0,
            weight: 0.0,
        });
    }
    Extension { count, edges }
}

/// Keeps each hinted node near its hint: `weight * |rank - hint|`. The hints form a rigid chain of reference nodes, one
/// per rank from the lowest hint to the highest, linked at minimum length 1 with `CHAIN_WEIGHT`. Each hinted node gets
/// a mediator with two edges of `weight`, to the node and to its chain node. The mediator is pushed up to the lower of
/// the two, so its cost is `weight * |rank - hint|`. `hints[i]` is the hint for node `i`, or `None` for none.
pub(super) fn hint_constraints(count: usize, hints: &[Option<u32>], weight: f64) -> Extension {
    let hinted: Vec<(usize, u32)> = hints
        .iter()
        .enumerate()
        .filter_map(|(node, rank)| rank.map(|rank| (node, rank)))
        .collect();
    let (Some(lo), Some(hi)) = (
        hinted.iter().map(|&(_, r)| r).min(),
        hinted.iter().map(|&(_, r)| r).max(),
    ) else {
        return Extension {
            count,
            edges: Vec::new(),
        };
    };
    let chain_start = count;
    let span = (hi - lo) as usize;
    let mut edges = Vec::new();
    for r in 1..=span {
        edges.push(NetworkEdge {
            tail: chain_start + r - 1,
            head: chain_start + r,
            min_length: 1.0,
            weight: CHAIN_WEIGHT,
        });
    }
    let mut next = chain_start + span + 1;
    for (node, rank) in hinted {
        let mediator = next;
        next += 1;
        let reference = chain_start + (rank - lo) as usize;
        edges.push(NetworkEdge {
            tail: mediator,
            head: node,
            min_length: 0.0,
            weight,
        });
        edges.push(NetworkEdge {
            tail: mediator,
            head: reference,
            min_length: 0.0,
            weight,
        });
    }
    Extension { count: next, edges }
}
