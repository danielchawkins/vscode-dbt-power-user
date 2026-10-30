import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { solveSeparationsReference } from "../testing/vpscReference.js";
import { type Separation, solveSeparations } from "./vpsc.js";
import { Blocks } from "./vpscBlocks.js";
import { Forest } from "./vpscForest.js";

// Differential test: the production solver against its frozen base copy (src/testing/vpscReference*.ts). Every
// coordinate must match bit for bit, so the comparison is Object.is (it also separates -0 from 0), and an input that
// one solver rejects must be rejected by the other with the same message. The values are drawn from small grids, so
// slacks, multipliers and block positions tie often, which is where a changed tie-break would show.
//
// The random instances only separate distinct variables, and every separation runs from a lower index to a higher one,
// so they form a DAG and are accepted. The chain instances make the split side run: a chain of separations with x0
// decreasing against it merges into one block, and cross edges then leave merged blocks with negative multipliers.
// The coverage test counts how often the split side runs, so a generator that stops reaching it fails.

/** Fixed seed, so every run draws the same instances. */
const SEED = 20_260_701;

interface Instance {
  x0: number[];
  weight: number[];
  seps: Separation[];
}

const coordinate = fc.constantFrom(-1, 0, 0.25, 0.5, 1, 1.5, 2, 3);
const weight = fc.constantFrom(0.5, 1, 1, 2);
const gap = fc.constantFrom(-1, 0, 0, 0.5, 1, 1, 2);

/** Random forward separations over n variables, between distinct variables. */
function instance(maxN: number, maxSeps: number): fc.Arbitrary<Instance> {
  return fc.integer({ min: 1, max: maxN }).chain((n) =>
    fc.record({
      x0: fc.array(coordinate, { minLength: n, maxLength: n }),
      weight: fc.array(weight, { minLength: n, maxLength: n }),
      seps:
        n === 1
          ? fc.constant<Separation[]>([])
          : fc
              .array(
                fc.record({
                  a: fc.integer({ min: 0, max: n - 2 }),
                  b: fc.integer({ min: 1, max: n - 1 }),
                  gap,
                }),
                { maxLength: maxSeps },
              )
              .map((rows) =>
                rows.map(({ a, b, gap: g }) => {
                  // to lies in a+1..n-1, so the pair is distinct and runs from the lower index to the higher.
                  const to = a + 1 + ((b - 1) % (n - 1 - a));
                  return { from: a, to, gap: g };
                }),
              ),
    }),
  );
}

/**
 * A chain 0 -> 1 -> ... -> n-1 with x0 decreasing along it, plus forward cross edges that skip ahead. The chain
 * merges into blocks, and the cross edges, pulling against the x0 order, leave merged blocks with negative multipliers.
 */
function chainInstance(maxN: number): fc.Arbitrary<Instance> {
  return fc
    .record({
      n: fc.integer({ min: 3, max: maxN }),
      step: fc.constantFrom(0, 0.5, 1, 2),
    })
    .chain(({ n, step }) =>
      fc
        .record({
          noise: fc.array(coordinate, { minLength: n, maxLength: n }),
          weight: fc.array(weight, { minLength: n, maxLength: n }),
          chainGap: fc.array(gap, { minLength: n - 1, maxLength: n - 1 }),
          cross: fc.array(
            fc.record({
              a: fc.integer({ min: 0, max: n - 1 }),
              skip: fc.integer({ min: 2, max: Math.max(2, n - 1) }),
              gap,
            }),
            { maxLength: n },
          ),
        })
        .map(({ noise, weight: w, chainGap, cross }) => {
          const seps: Separation[] = chainGap.map((g, i) => ({
            from: i,
            to: i + 1,
            gap: g,
          }));
          for (const { a, skip, gap: g } of cross) {
            if (a + skip < n) {
              seps.push({ from: a, to: a + skip, gap: g });
            }
          }
          return {
            x0: noise.map((c, i) => c - step * i),
            weight: w,
            seps,
          };
        }),
    );
}

type Outcome = { x: number[] } | { error: string };

function outcomeOf(solve: () => number[]): Outcome {
  try {
    return { x: solve() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function expectSameSolution(inst: Instance): void {
  const want = outcomeOf(() =>
    solveSeparationsReference(inst.x0, inst.weight, inst.seps),
  );
  const got = outcomeOf(() =>
    solveSeparations(inst.x0, inst.weight, inst.seps),
  );
  if (!("x" in want) || !("x" in got)) {
    expect(got).toEqual(want);
    return;
  }
  expect(got.x.length).toBe(want.x.length);
  want.x.forEach((expected, i) => {
    expect(Object.is(got.x[i], expected), `coordinate ${i}`).toBe(true);
  });
}

describe("solveSeparations against the frozen base solver", () => {
  it("returns the same bits on random tie-heavy constraint sets of up to 24 variables", () => {
    fc.assert(fc.property(instance(24, 72), expectSameSolution), {
      seed: SEED,
      numRuns: 1500,
    });
  });

  it("returns the same bits on random tie-heavy constraint sets of up to 60 variables", () => {
    fc.assert(fc.property(instance(60, 180), expectSameSolution), {
      seed: SEED + 1,
      numRuns: 300,
    });
  });

  it("returns the same bits on long chains with cross edges, up to 120 variables", () => {
    fc.assert(fc.property(chainInstance(120), expectSameSolution), {
      seed: SEED + 2,
      numRuns: 300,
    });
  });

  it("runs the split, within-block and multi-block walk paths on a large share of the chain instances", () => {
    const sample = fc.sample(chainInstance(60), {
      seed: SEED + 3,
      numRuns: 300,
    });
    const split = vi.spyOn(Blocks.prototype, "split");
    const within = vi.spyOn(Blocks.prototype, "resolveWithin");
    const walks = vi.spyOn(Forest.prototype, "componentOrder");
    const negativeIn = Blocks.prototype.negativeIn;
    let withSplit = 0;
    let withWithin = 0;
    let withSeveralWalks = 0;
    let severalWalks = false;
    Blocks.prototype.negativeIn = function (...args) {
      const before = walks.mock.calls.length;
      const result = negativeIn.apply(this, args);
      if (walks.mock.calls.length - before > 1) {
        severalWalks = true;
      }
      return result;
    };
    try {
      for (const inst of sample) {
        split.mockClear();
        within.mockClear();
        walks.mockClear();
        severalWalks = false;
        solveSeparations(inst.x0, inst.weight, inst.seps);
        if (split.mock.calls.length > 0) {
          withSplit += 1;
        }
        if (within.mock.calls.length > 0) {
          withWithin += 1;
        }
        if (severalWalks) {
          withSeveralWalks += 1;
        }
      }
    } finally {
      Blocks.prototype.negativeIn = negativeIn;
      vi.restoreAllMocks();
    }
    expect(withSplit / sample.length).toBeGreaterThanOrEqual(0.5);
    expect(withWithin / sample.length).toBeGreaterThanOrEqual(0.2);
    expect(withSeveralWalks / sample.length).toBeGreaterThanOrEqual(0.05);
  });
});
