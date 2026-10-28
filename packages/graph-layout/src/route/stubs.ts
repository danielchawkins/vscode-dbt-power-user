import type { LayeredGraph, PortDummy } from "../layering.js";

interface Stub {
  dummy: number;
  port: PortDummy;
}

/**
 * The crossings that lateral stubs make with the runs of their own block. A stub leaves its owner's side at its port's
 * across position and runs along the in-rank axis to its member's slot in the dummy. The run then goes off across the
 * rank: toward the band below when the dummy is `below`, otherwise it comes from the band above. The bands count only
 * the runs, so a stub that crosses the across part of a nearer dummy's run is counted here, once for each pair of runs.
 * Runs of one port share a trunk and are not counted, as in `measureDrawing`.
 */
export function stubCrossings(
  layered: LayeredGraph,
  inRank: readonly number[],
  portAcross: readonly (number | undefined)[],
): number {
  const sides = new Map<number, Stub[]>();
  layered.nodes.forEach((node, dummy) => {
    if (node.port !== undefined) {
      const key = node.port.owner * 2 + (node.port.after ? 1 : 0);
      sides.set(key, [...(sides.get(key) ?? []), { dummy, port: node.port }]);
    }
  });
  const distance = (stub: Stub): number =>
    Math.abs((inRank[stub.dummy] ?? 0) - (inRank[stub.port.owner] ?? 0));
  const acrossOf = (stub: Stub): number => portAcross[stub.dummy] ?? 0;
  // The stub of `a` crosses the run of `b` when `b` lies nearer the owner and `a`'s across position lies within `b`'s run.
  const crosses = (a: Stub, b: Stub): boolean =>
    distance(b) < distance(a) &&
    (b.port.below ? acrossOf(a) > acrossOf(b) : acrossOf(a) < acrossOf(b));
  let total = 0;
  for (const stubs of sides.values()) {
    for (const a of stubs) {
      for (const b of stubs) {
        if (crosses(a, b)) {
          total += a.port.runs * b.port.runs;
        }
      }
    }
  }
  return total;
}
