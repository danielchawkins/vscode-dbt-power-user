import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  compareDrawings,
  type Drawing,
  type DrawnPath,
  measureDrawing,
} from "./metrics.js";
import type { Rect } from "./types.js";

const box = (x: number, y: number, side = 10): Rect => ({
  x,
  y,
  width: side,
  height: side,
});

const path = (
  points: [number, number][],
  source = "s",
  target = "t",
): DrawnPath => ({
  points: points.map(([x, y]) => ({ x, y })),
  source,
  target,
});

const drawingOf = (
  boxes: [string, Rect][],
  paths: [string, DrawnPath][],
  extra: Partial<Drawing> = {},
): Drawing => ({
  boxes: new Map(boxes),
  paths: new Map(paths),
  ...extra,
});

describe("measureDrawing", () => {
  it("counts one proper crossing between two perpendicular edges", () => {
    const m = measureDrawing(
      drawingOf(
        [],
        [
          [
            "a",
            path([
              [-10, 5],
              [20, 5],
            ]),
          ],
          [
            "b",
            path([
              [5, -10],
              [5, 20],
            ]),
          ],
        ],
      ),
    );
    expect(m.crossings).toBe(1);
    expect(m.bends).toBe(0);
  });

  it("does not count two edges that only touch at an end", () => {
    const m = measureDrawing(
      drawingOf(
        [],
        [
          [
            "a",
            path([
              [0, 5],
              [5, 5],
            ]),
          ],
          [
            "b",
            path([
              [5, 0],
              [5, 10],
            ]),
          ],
        ],
      ),
    );
    expect(m.crossings).toBe(0);
  });

  it("does not count an edge crossing itself", () => {
    const m = measureDrawing(
      drawingOf(
        [],
        [
          [
            "a",
            path([
              [0, 5],
              [10, 5],
              [10, 15],
              [5, 15],
              [5, 0],
            ]),
          ],
        ],
      ),
    );
    expect(m.crossings).toBe(0);
  });

  it("does not count edges that share a trunk", () => {
    const paths: [string, DrawnPath][] = [
      [
        "a",
        path([
          [0, 5],
          [10, 5],
        ]),
      ],
      [
        "b",
        path([
          [5, 0],
          [5, 10],
        ]),
      ],
    ];
    expect(measureDrawing(drawingOf([], paths)).crossings).toBe(1);
    const shared = drawingOf([], paths, { trunkOf: () => "port" });
    expect(measureDrawing(shared).crossings).toBe(0);
  });

  it("still counts crossings between edges on different trunks", () => {
    const paths: [string, DrawnPath][] = [
      [
        "a",
        path([
          [0, 5],
          [10, 5],
        ]),
      ],
      [
        "b",
        path([
          [5, 0],
          [5, 10],
        ]),
      ],
    ];
    const apart = drawingOf([], paths, { trunkOf: (id) => id });
    expect(measureDrawing(apart).crossings).toBe(1);
  });

  it("counts a crossing at a point inside another edge's collinear run", () => {
    const m = measureDrawing(
      drawingOf(
        [],
        [
          [
            "a",
            path([
              [0, 5],
              [10, 5],
            ]),
          ],
          [
            "b",
            path([
              [5, 0],
              [5, 5],
              [5, 10],
            ]),
          ],
        ],
      ),
    );
    expect(m.crossings).toBe(1);
    expect(m.bends).toBe(0);
  });

  it("counts a crossing at a point inside the crossing edge's own collinear run", () => {
    const m = measureDrawing(
      drawingOf(
        [],
        [
          [
            "a",
            path([
              [0, 5],
              [5, 5],
              [10, 5],
            ]),
          ],
          [
            "b",
            path([
              [5, 0],
              [5, 10],
            ]),
          ],
        ],
      ),
    );
    expect(m.crossings).toBe(1);
  });

  it("counts a crossing once when an edge doubles back over the crossed edge", () => {
    const m = measureDrawing(
      drawingOf(
        [],
        [
          [
            "a",
            path([
              [0, 5],
              [8, 5],
              [3, 5],
            ]),
          ],
          [
            "b",
            path([
              [5, 0],
              [5, 10],
            ]),
          ],
        ],
      ),
    );
    expect(m.crossings).toBe(1);
  });

  it("measures a 200,000-point path without spreading it into call arguments", () => {
    const line = Array.from({ length: 200_000 }, (_, i): [number, number] => [
      i,
      0,
    ]);
    const straight = measureDrawing(
      drawingOf(
        [],
        [
          ["line", path(line)],
          [
            "cross",
            path([
              [100_000, -5],
              [100_000, 5],
            ]),
          ],
        ],
      ),
    );
    expect(straight.crossings).toBe(1);
    expect(straight.bends).toBe(0);
    expect(straight.edgeLength).toBe(199_999 + 10);
    expect(straight.area).toBe(199_999 * 10);

    // Every point turns: unit steps alternate between east and south.
    const stairs = Array.from({ length: 200_000 }, (_, i): [number, number] => [
      Math.floor((i + 1) / 2),
      Math.floor(i / 2),
    ]);
    const m = measureDrawing(drawingOf([], [["stairs", path(stairs)]]));
    expect(m.bends).toBe(199_998);
    expect(m.edgeLength).toBe(199_999);
    expect(m.area).toBe(100_000 * 99_999);
  });

  it("counts a bend where the direction turns and not where it stays straight", () => {
    const bent = measureDrawing(
      drawingOf(
        [],
        [
          [
            "a",
            path([
              [0, 0],
              [10, 0],
              [10, 10],
            ]),
          ],
        ],
      ),
    );
    const straight = measureDrawing(
      drawingOf(
        [],
        [
          [
            "a",
            path([
              [0, 0],
              [5, 0],
              [10, 0],
            ]),
          ],
        ],
      ),
    );
    expect(bent.bends).toBe(1);
    expect(bent.edgeLength).toBe(20);
    expect(straight.bends).toBe(0);
    expect(straight.edgeLength).toBe(10);
  });

  it("reports an edge running through a node it does not end at", () => {
    const m = measureDrawing(
      drawingOf(
        [
          ["s", box(0, 0)],
          ["t", box(100, 0)],
          ["mid", box(40, 0)],
        ],
        [
          [
            "a",
            path(
              [
                [5, 5],
                [105, 5],
              ],
              "s",
              "t",
            ),
          ],
        ],
      ),
    );
    expect(m.overlaps).toBe(1);
  });

  it("does not report an edge running through the node it ends at", () => {
    const m = measureDrawing(
      drawingOf(
        [
          ["s", box(0, 0)],
          ["t", box(100, 0)],
        ],
        [
          [
            "a",
            path(
              [
                [5, 5],
                [105, 5],
              ],
              "s",
              "t",
            ),
          ],
        ],
      ),
    );
    expect(m.overlaps).toBe(0);
  });

  it("reports two overlapping nodes once", () => {
    const m = measureDrawing(
      drawingOf([
        ["a", box(0, 0)],
        ["b", box(5, 5)],
        ["c", box(50, 0)],
      ]),
    );
    expect(m.overlaps).toBe(1);
  });

  it("measures area from the nodes and the paths, and density from node area", () => {
    const m = measureDrawing(
      drawingOf(
        [["a", box(0, 0)]],
        [
          [
            "e",
            path(
              [
                [0, 0],
                [30, 0],
                [30, 20],
              ],
              "a",
              "b",
            ),
          ],
        ],
      ),
    );
    expect(m.area).toBe(30 * 20);
    expect(m.density).toBeCloseTo(100 / 600);
  });

  it("is zero for an empty drawing", () => {
    expect(measureDrawing(drawingOf([], []))).toEqual({
      crossings: 0,
      bends: 0,
      edgeLength: 0,
      area: 0,
      density: 0,
      overlaps: 0,
      opaqueBreaches: 0,
    });
  });
});

type Polyline = [number, number][];

/** An orthogonal polyline from random points: each step runs horizontal, then vertical. */
const orthogonal: fc.Arbitrary<Polyline> = fc
  .array(
    fc.tuple(fc.integer({ min: 0, max: 12 }), fc.integer({ min: 0, max: 12 })),
    { minLength: 2, maxLength: 4 },
  )
  .map((pts) => pts.flatMap(corner));

function corner([x, y]: [number, number], i: number, all: Polyline): Polyline {
  const next = all[i + 1];
  return next
    ? [
        [x, y],
        [next[0], y],
      ]
    : [[x, y]];
}

const paths = fc.array(orthogonal, { minLength: 1, maxLength: 6 });

const GRID = 12;

interface UnitSteps {
  horizontal: Set<string>;
  vertical: Set<string>;
}

/** Brute force: the unit grid steps a polyline covers, named by the point they start from. Independent of segments. */
function unitStepsOf(pts: Polyline): UnitSteps {
  const steps: UnitSteps = { horizontal: new Set(), vertical: new Set() };
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b) {
      continue;
    }
    if (a[1] === b[1]) {
      for (let x = Math.min(a[0], b[0]); x < Math.max(a[0], b[0]); x++) {
        steps.horizontal.add(`${x},${a[1]}`);
      }
    } else {
      for (let y = Math.min(a[1], b[1]); y < Math.max(a[1], b[1]); y++) {
        steps.vertical.add(`${a[0]},${y}`);
      }
    }
  }
  return steps;
}

/** Brute force: a polyline runs straight through a grid point when it covers the steps on both sides of it. */
const passesHorizontally = (steps: Set<string>, x: number, y: number) =>
  steps.has(`${x - 1},${y}`) && steps.has(`${x},${y}`);
const passesVertically = (steps: Set<string>, x: number, y: number) =>
  steps.has(`${x},${y - 1}`) && steps.has(`${x},${y}`);

/**
 * Brute force on the unit grid: a grid point is a crossing when one edge runs straight through it horizontally and
 * another runs straight through it vertically. Edges that `sameTrunk` relates never count.
 */
function bruteCrossings(
  polylines: Polyline[],
  sameTrunk: (i: number, j: number) => boolean = () => false,
): number {
  const steps = polylines.map(unitStepsOf);
  let count = 0;
  for (let x = 0; x <= GRID; x++) {
    for (let y = 0; y <= GRID; y++) {
      steps.forEach((h, i) => {
        steps.forEach((v, j) => {
          if (
            i !== j &&
            !sameTrunk(i, j) &&
            passesHorizontally(h.horizontal, x, y) &&
            passesVertically(v.vertical, x, y)
          ) {
            count++;
          }
        });
      });
    }
  }
  return count;
}

const indexOf = (id: string) => Number(id.slice(1));
const parityOf = (i: number) => (i % 2 === 0 ? "even" : "odd");

const toDrawing = (
  polylines: Polyline[],
  extra: Partial<Drawing> = {},
): Drawing =>
  drawingOf(
    [],
    polylines.map((pts, i): [string, DrawnPath] => [`e${i}`, path(pts)]),
    extra,
  );

describe("measureDrawing properties", () => {
  it("counts crossings as the brute-force pair count", () => {
    fc.assert(
      fc.property(paths, (polylines) => {
        expect(measureDrawing(toDrawing(polylines)).crossings).toBe(
          bruteCrossings(polylines),
        );
      }),
      { numRuns: 300 },
    );
  });

  it("leaves out only the pairs that share a trunk", () => {
    fc.assert(
      fc.property(paths, (polylines) => {
        const trunkOf = (id: string) => parityOf(indexOf(id));
        expect(
          measureDrawing(toDrawing(polylines, { trunkOf })).crossings,
        ).toBe(
          bruteCrossings(polylines, (i, j) => parityOf(i) === parityOf(j)),
        );
      }),
      { numRuns: 300 },
    );
  });

  it("is unchanged by translating every point and box", () => {
    fc.assert(
      fc.property(
        paths,
        fc.integer({ min: -50, max: 50 }),
        fc.integer({ min: -50, max: 50 }),
        (polylines, dx, dy) => {
          const shift = (pts: Polyline): Polyline =>
            pts.map(([x, y]) => [x + dx, y + dy]);
          const base = toDrawing(polylines, {
            boxes: new Map([["n", box(1, 1, 4)]]),
          });
          const moved = toDrawing(polylines.map(shift), {
            boxes: new Map([["n", box(1 + dx, 1 + dy, 4)]]),
          });
          expect(measureDrawing(moved)).toEqual(measureDrawing(base));
        },
      ),
      { numRuns: 200 },
    );
  });

  it("never lowers the crossing count when a path is added", () => {
    fc.assert(
      fc.property(paths, orthogonal, (polylines, extra) => {
        const before = measureDrawing(toDrawing(polylines)).crossings;
        const after = measureDrawing(
          toDrawing([...polylines, extra]),
        ).crossings;
        expect(after).toBeGreaterThanOrEqual(before);
      }),
      { numRuns: 200 },
    );
  });
});

describe("compareDrawings", () => {
  const nodes: [string, Rect][] = [
    ["a", box(0, 0)],
    ["b", box(0, 30)],
    ["c", box(30, 0)],
  ];

  it("shows no change when a drawing is compared with itself", () => {
    const d = drawingOf(nodes, [], {
      ranks: new Map([
        ["a", 0],
        ["b", 1],
        ["c", 0],
      ]),
    });
    expect(compareDrawings(d, d, { anchor: "a" })).toEqual({
      retained: 3,
      meanDisplacement: 0,
      maxDisplacement: 0,
      orderFlips: 0,
      rankChanges: 0,
    });
  });

  it("measures displacement relative to the anchor, so a translation is free", () => {
    const before = drawingOf(nodes, []);
    const shifted = drawingOf(
      nodes.map(([id, b]): [string, Rect] => [id, { ...b, x: b.x + 100 }]),
      [],
    );
    expect(
      compareDrawings(before, shifted, { anchor: "a" }).maxDisplacement,
    ).toBe(0);
    expect(compareDrawings(before, shifted).maxDisplacement).toBeCloseTo(100);
  });

  it("counts same-band order flips and rank changes", () => {
    const before = drawingOf(nodes, [], {
      ranks: new Map([
        ["a", 0],
        ["b", 1],
        ["c", 0],
      ]),
    });
    // a and c share the top band; swap their x order and move b to rank 2.
    const after = drawingOf(
      [
        ["a", box(40, 0)],
        ["b", box(0, 60)],
        ["c", box(0, 0)],
      ],
      [],
      {
        ranks: new Map([
          ["a", 0],
          ["b", 2],
          ["c", 0],
        ]),
      },
    );
    const result = compareDrawings(before, after);
    expect(result.orderFlips).toBe(1);
    expect(result.rankChanges).toBe(1);
  });

  it("does not count a node that changes rank as an order flip", () => {
    const before = drawingOf(nodes, [], {
      ranks: new Map([
        ["a", 0],
        ["b", 1],
        ["c", 0],
      ]),
    });
    // a drops out of the top band, so it no longer overlaps c on the rank axis and cannot flip with it.
    const after = drawingOf(
      [
        ["a", box(40, 60)],
        ["b", box(0, 30)],
        ["c", box(0, 0)],
      ],
      [],
      {
        ranks: new Map([
          ["a", 2],
          ["b", 1],
          ["c", 0],
        ]),
      },
    );
    const result = compareDrawings(before, after);
    expect(result.orderFlips).toBe(0);
    expect(result.rankChanges).toBe(1);
  });

  it("reads bands along x and order along y when direction is right", () => {
    // a and b share one column (they overlap in x); their y order swaps.
    const before = drawingOf(
      [
        ["a", box(0, 0)],
        ["b", box(0, 40)],
      ],
      [],
    );
    const after = drawingOf(
      [
        ["a", box(0, 40)],
        ["b", box(0, 0)],
      ],
      [],
    );
    expect(
      compareDrawings(before, after, { direction: "right" }).orderFlips,
    ).toBe(1);
    expect(compareDrawings(before, after).orderFlips).toBe(0);
  });

  it("leaves rankChanges undefined when one drawing has no ranks", () => {
    const d = drawingOf(nodes, []);
    expect(compareDrawings(d, d).rankChanges).toBeUndefined();
  });

  it("is zero against itself for any drawing", () => {
    fc.assert(
      fc.property(paths, (polylines) => {
        const d = toDrawing(polylines, { boxes: new Map(nodes) });
        const r = compareDrawings(d, d, { anchor: "a" });
        expect(r.maxDisplacement).toBe(0);
        expect(r.orderFlips).toBe(0);
      }),
      { numRuns: 50 },
    );
  });
});
