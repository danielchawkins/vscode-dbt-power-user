import {
  adjacency,
  alignBlocks,
  frameOf,
  typeOneConflicts,
} from "./bkAlignment.js";
import { compact } from "./bkCompaction.js";
import type { Problem } from "./problem.js";
import { projectRanks } from "./projection.js";

/** One horizontal pass: its coordinates in the drawing's orientation, and whether it ran mirrored. */
interface Run {
  x: number[];
  mirror: boolean;
}

/**
 * Brandes and Köpf's linear-time horizontal coordinate assignment (GD 2001), with the corrections of Brandes, Walter and
 * Zink's erratum (arXiv 2008.01252) to its compaction. Four alignments (down or up, left or right) are compacted; each
 * is moved to the width of the narrowest, and every node takes the average of the two middle positions of its four.
 * Port offsets are not part of the alignment: the quadratic phase applies them. The compaction can leave a gap short
 * (its class shifts do not chain), so the balanced result is projected back onto the gaps, which keeps the order.
 * Coordinates are centres along the in-rank axis.
 */
export function brandesKoepf(problem: Problem): number[] {
  const n = problem.dummy.length;
  const conflict = typeOneConflicts(problem);
  const { above, below } = adjacency(problem);
  const runs: Run[] = [];
  for (const fromAbove of [true, false]) {
    for (const mirror of [false, true]) {
      const frame = frameOf(problem, mirror);
      const blocks = alignBlocks(frame, {
        adjacent: fromAbove ? above : below,
        conflict,
        fromAbove,
      });
      const x = compact(frame, blocks);
      if (mirror) {
        x.forEach((value, v) => (x[v] = -value));
      }
      runs.push({ x, mirror });
    }
  }
  const x = balance(runs, n);
  projectRanks(
    problem,
    x,
    Array.from({ length: n }, () => 1),
  );
  return x;
}

/** Moves each run to the width of the narrowest, then takes each node's mean of its two middle coordinates. */
function balance(runs: readonly Run[], n: number): number[] {
  const extent = (x: readonly number[]) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const value of x) {
      lo = Math.min(lo, value);
      hi = Math.max(hi, value);
    }
    return { lo, hi };
  };
  const narrow = runs.reduce((best, run) =>
    extent(run.x).hi - extent(run.x).lo < extent(best.x).hi - extent(best.x).lo
      ? run
      : best,
  );
  const target = extent(narrow.x);
  const aligned = runs.map((run) => {
    const own = extent(run.x);
    const by = run.mirror ? target.hi - own.hi : target.lo - own.lo;
    return run.x.map((value) => value + by);
  });
  const out: number[] = [];
  for (let v = 0; v < n; v++) {
    const values = aligned.map((x) => x[v]!).sort((a, b) => a - b);
    out.push((values[1]! + values[2]!) / 2);
  }
  return out;
}
