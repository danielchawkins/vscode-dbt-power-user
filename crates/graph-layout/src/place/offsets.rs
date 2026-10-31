//! Port offsets, a port of `packages/graph-layout/src/offsets.ts`. The sides and the direction belong to the model, which
//! `place` may not import (ADR 0011, module table), so the functions are generic over the side type and take the
//! direction as `down`: true when ranks run down, false when they run right.

/// The node's extent along the in-rank axis: its width when ranks run down, its height when they run right.
pub(crate) fn in_rank_extent(width: f64, height: f64, down: bool) -> f64 {
    if down { width } else { height }
}

/// One member's port at one end: the side the port sits on and its offset along the breadth, when it names a port.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct PortAt<S> {
    pub(crate) side: S,
    pub(crate) offset: f64,
}

/// The mean offset, from the node's centre, of the port that each member names at one end. A member that names no port,
/// or a port on another side, contributes zero. `breadth` is the node's extent across the ranks; `ports` has one entry
/// per member, and an empty slice gives NaN, as the TypeScript division does.
pub(crate) fn mean_port_offset<S: PartialEq>(
    ports: &[Option<PortAt<S>>],
    side: &S,
    breadth: f64,
) -> f64 {
    let total = ports.iter().fold(0.0_f64, |sum, port| match port {
        Some(p) if p.side == *side => sum + (p.offset - breadth / 2.0),
        _ => sum,
    });
    // A member count is far below 2^32, so the conversion is exact.
    total / f64::from(u32::try_from(ports.len()).unwrap_or(u32::MAX))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, Clone, Copy, PartialEq)]
    enum Side {
        North,
        South,
    }

    #[test]
    fn in_rank_extent_is_width_going_down_and_height_going_right() {
        assert_eq!(in_rank_extent(3.0, 5.0, true), 3.0);
        assert_eq!(in_rank_extent(3.0, 5.0, false), 5.0);
    }

    #[test]
    fn mean_port_offset_counts_only_ports_on_the_side_and_divides_by_members() {
        let ports = [
            Some(PortAt {
                side: Side::South,
                offset: 12.0,
            }),
            Some(PortAt {
                side: Side::North,
                offset: 99.0,
            }),
            None,
            Some(PortAt {
                side: Side::South,
                offset: 4.0,
            }),
        ];
        // breadth 10: (12 - 5) + (4 - 5) = 6, over four members.
        assert_eq!(mean_port_offset(&ports, &Side::South, 10.0), 1.5);
    }
}
