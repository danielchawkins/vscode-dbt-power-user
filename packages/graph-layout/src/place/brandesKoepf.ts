import {
  adjacency,
  alignBlocks,
  type Blocks,
  type Frame,
  frameOf,
  typeOneConflicts,
} from "./bkAlignment.js";
import type { Problem } from "./problem.js";
import { projectRanks } from "./projection.js";

/** One horizontal pass: its coordinates in the drawing's orientation, and whether it ran mirrored. */
interface Run {
  x: number[];
  mirror: boolean;
}

/**
 * Brandes and Köpf's linear-time horizontal coordinate assignment (GD 2001). Four alignments (down or up, left or
 * right) are compacted; each is moved to the width of the narrowest, and every node takes the average of the two
 * middle positions of its four. Port offsets are not part of the alignment: the quadratic phase applies them. The
 * compaction can leave a gap short (its class shifts do not chain), so the balanced result is projected back onto the
 * gaps, which keeps the order. Coordinates are centres along the in-rank axis.
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

/**
 * Horizontal compaction (Brandes and Köpf, section 3): each block is placed as far left as its neighbours allow, and
 * the blocks of one sink class are shifted together. The coordinates are those of the pass's own frame.
 */
function compact(frame: Frame, { root, align }: Blocks): number[] {
  const n = root.length;
  const sink = Array.from({ length: n }, (_, v) => v);
  const shift = Array.from({ length: n }, () => Infinity);
  const x: number[] = Array.from({ length: n }, () => 0);
  const placed = Array.from({ length: n }, () => false);
  const place = (v: number): void => {
    if (placed[v]) {
      return;
    }
    placed[v] = true;
    x[v] = 0;
    let w = v;
    do {
      const left = frame.left[w]!;
      if (left >= 0) {
        const u = root[left]!;
        place(u);
        if (sink[v] === v) {
          sink[v] = sink[u]!;
        }
        if (sink[v] === sink[u]) {
          x[v] = Math.max(x[v], x[u]! + frame.gap[w]!);
        } else {
          shift[sink[u]!] = Math.min(
            shift[sink[u]!]!,
            x[v] - x[u]! - frame.gap[w]!,
          );
        }
      }
      w = align[w]!;
    } while (w !== v);
  };
  for (let v = 0; v < n; v++) {
    if (root[v] === v) {
      place(v);
    }
  }
  const out: number[] = [];
  for (let v = 0; v < n; v++) {
    const r = root[v]!;
    const s = shift[sink[r]!]!;
    out.push(x[r]! + (s < Infinity ? s : 0));
  }
  return out;
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
