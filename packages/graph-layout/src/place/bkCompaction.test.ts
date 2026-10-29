import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { problemArb } from "../testing/problems.js";
import {
  adjacency,
  alignBlocks,
  frameOf,
  typeOneConflicts,
} from "./bkAlignment.js";
import { compact } from "./bkCompaction.js";
import type { Problem } from "./problem.js";

/** Slack for the floating-point sums of gaps. */
const TOLERANCE = 1e-9;

/** Each of the four compacted runs of `problem`: its frame's coordinates, with the frame's left neighbours. */
function runsOf(problem: Problem) {
  const conflict = typeOneConflicts(problem);
  const { above, below } = adjacency(problem);
  return [true, false].flatMap((fromAbove) =>
    [false, true].map((mirror) => {
      const frame = frameOf(problem, mirror);
      const blocks = alignBlocks(frame, {
        adjacent: fromAbove ? above : below,
        conflict,
        fromAbove,
      });
      return { frame, x: compact(frame, blocks) };
    }),
  );
}

describe("compact (Brandes, Walter and Zink's corrected compaction)", () => {
  it("keeps every separation of every compacted run", () => {
    fc.assert(
      fc.property(problemArb, (problem) => {
        for (const { frame, x } of runsOf(problem)) {
          frame.left.forEach((left, w) => {
            if (left >= 0) {
              expect(x[w]! - x[left]!).toBeGreaterThanOrEqual(
                frame.gap[w]! - TOLERANCE,
              );
            }
          });
        }
      }),
      { numRuns: 500 },
    );
  });

  it("keeps the separations of a shift that must pass through a second class", () => {
    // Found by the property above and shrunk: the class of node 9's left neighbour must follow the shift of the
    // class it is pulled into, and stopping the shift at the first class leaves the separation at node 9 short.
    const problem: Problem = {
      layers: [[0], [1, 2, 3], [4, 5, 6, 7, 8, 9], [10, 11, 12, 13, 14, 15, 16]],
      gapLeft: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      dummy: [
        false, false, true, false, true, false, false, false, false, false,
        false, false, false, false, false, false, false,
      ],
      links: [
        { top: 5, bottom: 10, weight: 0.1, topOffset: 0, bottomOffset: 0 },
        { top: 1, bottom: 4, weight: 0.1, topOffset: 0, bottomOffset: 0 },
      ],
      pulls: [],
    };
    for (const { frame, x } of runsOf(problem)) {
      frame.left.forEach((left, w) => {
        if (left >= 0) {
          expect(x[w]! - x[left]!).toBeGreaterThanOrEqual(
            frame.gap[w]! - TOLERANCE,
          );
        }
      });
    }
  });
});
