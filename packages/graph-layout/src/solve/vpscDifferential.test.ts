import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { solveSeparationsReference } from "../testing/vpscReference.js";
import { type Separation, solveSeparations } from "./vpsc.js";

// Differential test: the production solver against its frozen base copy (src/testing/vpscReference*.ts). Every
// coordinate must match bit for bit, so the comparison is Object.is (it also separates -0 from 0), and an input that
// one solver rejects must be rejected by the other with the same message. The values are drawn from small grids, so
// slacks, multipliers and block positions tie often, which is where a changed tie-break would show.

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

/** Random constraints over n variables. Most run from the lower index to the higher, so they form a DAG. */
function instance(maxN: number, maxSeps: number): fc.Arbitrary<Instance> {
  return fc.integer({ min: 1, max: maxN }).chain((n) =>
    fc.record({
      x0: fc.array(coordinate, { minLength: n, maxLength: n }),
      weight: fc.array(weight, { minLength: n, maxLength: n }),
      seps: fc
        .array(
          fc.record({
            a: fc.integer({ min: 0, max: n - 1 }),
            b: fc.integer({ min: 0, max: n - 1 }),
            reversed: fc.integer({ min: 0, max: 9 }).map((k) => k === 0),
            gap,
          }),
          { maxLength: maxSeps },
        )
        .map((rows) =>
          rows.map(({ a, b, reversed, gap: g }) => ({
            from: reversed ? Math.max(a, b) : Math.min(a, b),
            to: reversed ? Math.min(a, b) : Math.max(a, b),
            gap: g,
          })),
        ),
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
});
