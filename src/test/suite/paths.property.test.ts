import fc from "fast-check";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { isAtOrBelow, isStrictlyBelow } from "../../core/paths";
import { NUM_RUNS } from "../arbitraries";

// Names chosen so that siblings share prefixes (`a`, `ab`) and children start with two dots (`..a`).
const segment = fc.constantFrom("a", "ab", "b", "..a", "..b", "x.y");
const segments = fc.array(segment, { minLength: 1, maxLength: 4 });
const toPath = (parts: readonly string[]) => `/${parts.join("/")}`;

// Segment-wise oracle: `p` is at or below `root` when root's segments are a prefix of p's.
const segmentsBelow = (root: readonly string[], p: readonly string[]) =>
  p.length >= root.length && root.every((part, i) => part === p[i]);

describe("isAtOrBelow and isStrictlyBelow properties", () => {
  it("agrees with a segment-wise prefix check", () => {
    fc.assert(
      fc.property(segments, segments, (root, p) => {
        const below = segmentsBelow(root, p);
        expect(isAtOrBelow(toPath(root), toPath(p))).toBe(below);
        expect(isStrictlyBelow(toPath(root), toPath(p))).toBe(
          below && p.length > root.length,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("accepts the root itself and rejects it strictly", () => {
    fc.assert(
      fc.property(segments, (root) => {
        expect(isAtOrBelow(toPath(root), toPath(root))).toBe(true);
        expect(isStrictlyBelow(toPath(root), toPath(root))).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("accepts every descendant of the root", () => {
    fc.assert(
      fc.property(segments, segments, (root, extra) => {
        const child = toPath([...root, ...extra]);
        expect(isAtOrBelow(toPath(root), child)).toBe(true);
        expect(isStrictlyBelow(toPath(root), child)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects a sibling whose name extends the root's last segment", () => {
    fc.assert(
      fc.property(segments, (root) => {
        const last = root.at(-1) ?? "";
        const sibling = toPath([...root.slice(0, -1), `${last}x`]);
        expect(isAtOrBelow(toPath(root), sibling)).toBe(false);
        expect(isStrictlyBelow(toPath(root), sibling)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects a path reached by climbing out of the root unless it names the root", () => {
    fc.assert(
      fc.property(segments, segment, (root, up) => {
        const escaped = path.join(toPath(root), "..", up);
        const same = path.resolve(escaped) === path.resolve(toPath(root));
        expect(isAtOrBelow(toPath(root), escaped)).toBe(same);
        expect(isStrictlyBelow(toPath(root), escaped)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
