import type { Blocks, Frame } from "./bkAlignment.js";

/**
 * A separation between two classes: the class `from` must be shifted by no more than the class `on` is shifted plus
 * `bound`, since the block `v` of class `on` sits `bound` to the right of the block `u` of class `from`.
 */
interface ClassBound {
  from: number;
  on: number;
  v: number;
  u: number;
  gap: number;
}

/**
 * Horizontal compaction (Brandes and Köpf, section 3), as corrected by Brandes, Walter and Zink's erratum
 * (arXiv 2008.01252): each block is placed as far left as its neighbours allow, relative to its class's sink; then each
 * class's shift is set from the final shifts of the classes it is pulled against, so that shifts accumulate along the
 * chain of classes; and each vertex takes its block's coordinate plus its class's shift, once.
 * The coordinates are those of the pass's own frame.
 */
export function compact(frame: Frame, blocks: Blocks): number[] {
  const { root, align } = blocks;
  const n = root.length;
  const sink = Array.from({ length: n }, (_, v) => v);
  const x: number[] = Array.from({ length: n }, () => 0);
  const bounds: ClassBound[] = [];
  const place = (v: number): void => {
    let w = v;
    do {
      const left = frame.left[w]!;
      if (left >= 0) {
        const u = root[left]!;
        if (sink[v] === v) {
          sink[v] = sink[u]!;
        }
        if (sink[v] === sink[u]) {
          x[v] = Math.max(x[v]!, x[u]! + frame.gap[w]!);
        } else {
          bounds.push({
            from: sink[u]!,
            on: sink[v]!,
            v,
            u,
            gap: frame.gap[w]!,
          });
        }
      }
      w = align[w]!;
    } while (w !== v);
  };
  for (const v of blockOrder(frame, blocks)) {
    place(v);
  }
  const shift = classShifts(n, bounds, x);
  const out: number[] = [];
  for (let v = 0; v < n; v++) {
    const r = root[v]!;
    out.push(x[r]! + shift[sink[r]!]!);
  }
  return out;
}

/**
 * The shift of each class: zero for a class no other class is pulled against, else the least of the shifts of the
 * classes it is pulled against plus their bounds. Classes are visited dependencies first, so each reads final shifts.
 */
function classShifts(
  n: number,
  bounds: readonly ClassBound[],
  x: readonly number[],
): number[] {
  const deps: { on: number; bound: number }[][] = Array.from(
    { length: n },
    () => [],
  );
  for (const b of bounds) {
    deps[b.from]!.push({ on: b.on, bound: x[b.v]! - x[b.u]! - b.gap });
  }
  const shift = Array.from({ length: n }, () => 0);
  for (const c of dependenciesFirst(deps)) {
    const pulls = deps[c]!;
    if (pulls.length > 0) {
      shift[c] = pulls.reduce(
        (least, p) => Math.min(least, shift[p.on]! + p.bound),
        Infinity,
      );
    }
  }
  return shift;
}

/** The classes, each after every class it depends on: an iterative depth-first post-order. */
function dependenciesFirst(
  deps: readonly (readonly { on: number }[])[],
): number[] {
  const out: number[] = [];
  const seen = Array.from({ length: deps.length }, () => false);
  for (let s = 0; s < deps.length; s++) {
    if (seen[s]) {
      continue;
    }
    seen[s] = true;
    const stack = [{ c: s, i: 0 }];
    while (stack.length > 0) {
      const top = stack.at(-1)!;
      const next = deps[top.c]![top.i];
      if (next === undefined) {
        stack.pop();
        out.push(top.c);
        continue;
      }
      top.i++;
      if (!seen[next.on]) {
        seen[next.on] = true;
        stack.push({ c: next.on, i: 0 });
      }
    }
  }
  return out;
}

/**
 * The block roots, each after every block to the left of one of its members: the order in which compaction can place
 * them. Iterative, so a rank thousands of nodes wide does not exhaust the stack.
 */
function blockOrder(frame: Frame, { root, align }: Blocks): number[] {
  const n = root.length;
  const seen = Array.from({ length: n }, () => false);
  const out: number[] = [];
  const leftBlock = (w: number): number => {
    const left = frame.left[w]!;
    return left >= 0 ? root[left]! : -1;
  };
  /** Depth-first over the blocks to the left of the members of `start`'s block, appending roots in post-order. */
  const visit = (start: number): void => {
    const stack = [{ v: start, w: start, started: false }];
    while (stack.length > 0) {
      const top = stack.at(-1)!;
      if (top.started && top.w === top.v) {
        stack.pop();
        out.push(top.v);
        continue;
      }
      top.started = true;
      const u = leftBlock(top.w);
      top.w = align[top.w]!;
      if (u >= 0 && !seen[u]) {
        seen[u] = true;
        stack.push({ v: u, w: u, started: false });
      }
    }
  };
  for (let s = 0; s < n; s++) {
    if (root[s] === s && !seen[s]) {
      seen[s] = true;
      visit(s);
    }
  }
  return out;
}
