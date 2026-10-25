import { describe, expect, it } from "vitest";
import { tableEdgeId } from "./edgeIds";
import { routeGutters, type TableRoute } from "./gutterRouter";
import type { LayeredNode } from "./layered";
import { layeredFlow } from "./layeredFlow";

const WIDTH = 280;
const HEIGHT = 100;

const node = (id: string, tag: string): LayeredNode => ({
  id,
  width: WIDTH,
  height: HEIGHT,
  tag,
});
const table = (parent: string, child: string): TableRoute => ({
  id: tableEdgeId(parent, child),
  parent,
  child,
});

/** Each card's start, as the flow lays it out, so routing sees the same geometry the view does. */
const flow = (start: string, nodes: LayeredNode[], pairs: [string, string][]) =>
  layeredFlow({
    start,
    nodes,
    tableRoutes: pairs.map(([parent, child]) => table(parent, child)),
    columnRoutes: [],
    relationshipRoutes: [],
    traceOn: false,
  });

describe("layeredFlow on a mixed-layer fixture", () => {
  // Two sources feed staging models, which feed the start node, which feeds two
  // marts. A seed also feeds the start node and one mart.
  const nodes = [
    node("src_a", "source"),
    node("src_b", "source"),
    node("seed", "source"),
    node("stg_a", "staging"),
    node("stg_b", "staging"),
    node("start", "intermediate"),
    node("fct_1", "marts"),
    node("fct_2", "marts"),
  ];
  const pairs: [string, string][] = [
    ["src_a", "stg_a"],
    ["src_b", "stg_b"],
    ["stg_a", "start"],
    ["stg_b", "start"],
    ["seed", "start"],
    ["start", "fct_1"],
    ["start", "fct_2"],
  ];

  it("routes the seed's skip edge round stg_a, which sits over the corridor, at the cost of one crossing", () => {
    // seed -> start skips the staging row, and stg_a is centred over the corridor; through the corridor the edge
    // would run under stg_a. It takes the gap beside stg_a instead and crosses one gutter run.
    const result = flow("start", nodes, pairs);
    expect(result.crossings).toBe(1);
    expect(result.hops).toBe(1);
  });

  it("draws one path per table edge, each a rounded orthogonal path", () => {
    const result = flow("start", nodes, pairs);
    for (const [parent, child] of pairs) {
      const path = result.paths.get(tableEdgeId(parent, child));
      expect(path?.d.startsWith("M")).toBe(true);
      expect(path?.d).not.toMatch(/NaN|Infinity/);
    }
  });

  it("draws the bands behind the cards: one per layer run, plus Other when it is used", () => {
    const result = flow("start", nodes, pairs);
    expect(result.bands.map((band) => band.tag)).toEqual([
      "source",
      "staging",
      "intermediate",
      "marts",
    ]);
  });

  it("counts a skip edge that interlaces a same-row edge as one crossing", () => {
    // seed -> fct_2 leaves the row above the start node by the right-hand outer channel, and src_b -> stg_b runs
    // left through the same gutter: their spans interlace, so no channel order removes the crossing.
    // Its crossing sits within a corner's reach of the bubble channel, so the router counts it but draws no hop.
    const result = flow("start", nodes, [...pairs, ["seed", "fct_2"]]);
    expect(result.crossings).toBe(1);
    expect(result.hops).toBe(0);
  });
});

describe("routeGutters", () => {
  // Two rows, each with two cards. a -> d and b -> c cross: a sits left of b, and c left of d, with c's column
  // inside a's span and b's column inside d's span, so one of the two must cross the other.
  const boxes = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >([
    ["a", { x: 0, y: 0, width: 100, height: 60 }],
    ["b", { x: 300, y: 0, width: 100, height: 60 }],
    ["c", { x: 100, y: 200, width: 100, height: 60 }],
    ["d", { x: 400, y: 200, width: 100, height: 60 }],
  ]);
  const rowOf = new Map([
    ["a", 0],
    ["b", 0],
    ["c", 1],
    ["d", 1],
  ]);
  const generation = new Map([
    ["a", -1],
    ["b", -1],
    ["c", 1],
    ["d", 1],
  ]);

  it("counts a crossing that no channel order removes, and draws it as one hop", () => {
    const result = routeGutters({
      focus: "x",
      boxes,
      rowOf,
      generation,
      layeredBounds: { left: 0, right: 500 },
      tableRoutes: [
        { id: "a-d", parent: "a", child: "d" },
        { id: "b-c", parent: "b", child: "c" },
      ],
      columnRoutes: [],
      relationshipRoutes: [],
      traceOn: false,
    });
    expect(result.crossings).toBe(1);
    expect(result.hops).toBe(1);
    expect(result.paths.get("a-d")?.d).toContain("A");
  });

  it("routes a relationship between cards in one row through the gutter below them", () => {
    const result = routeGutters({
      focus: "x",
      boxes,
      rowOf,
      generation,
      layeredBounds: { left: 0, right: 500 },
      tableRoutes: [],
      columnRoutes: [],
      relationshipRoutes: [{ id: "rel:a-b", from: "a", to: "b" }],
      traceOn: false,
    });
    const path = result.paths.get("rel:a-b");
    expect(path).toBeDefined();
    expect(path?.labelAt.y).toBeGreaterThan(60);
  });

  it("draws a column edge from the source card's right to the target card's left", () => {
    const result = routeGutters({
      focus: "x",
      boxes,
      rowOf,
      generation,
      layeredBounds: { left: 0, right: 500 },
      tableRoutes: [],
      columnRoutes: [{ id: "col", from: "a", fromY: 30, to: "c", toY: 230 }],
      relationshipRoutes: [],
      traceOn: true,
    });
    const path = result.paths.get("col");
    expect(path?.d.startsWith("M100,30")).toBe(true);
    expect(path?.d.endsWith("100,230") || path?.d.includes("100,230")).toBe(
      true,
    );
  });
});

describe("routeGutters speed", () => {
  // 60 cards in six rows of ten. Each card in the first five rows feeds the two cards below it and, in the first four
  // rows and the left half, the card two rows down: 100 + 20 = 120 table edges.
  const COLUMNS = 10;
  const ROWS = 6;
  const boxes = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  const rowOf = new Map<string, number>();
  const generation = new Map<string, number>();
  const tableRoutes: TableRoute[] = [];
  const name = (row: number, col: number) => `n${row}-${col}`;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLUMNS; col++) {
      const id = name(row, col);
      boxes.set(id, { x: col * 320, y: row * 160, width: 280, height: 100 });
      rowOf.set(id, row);
      generation.set(id, row - 2);
      if (row < ROWS - 1) {
        for (const target of [col, (col + 1) % COLUMNS]) {
          tableRoutes.push({
            id: `${id}->${name(row + 1, target)}`,
            parent: id,
            child: name(row + 1, target),
          });
        }
      }
      if (row < ROWS - 2 && col < COLUMNS / 2) {
        tableRoutes.push({
          id: `${id}=>${name(row + 2, col)}`,
          parent: id,
          child: name(row + 2, col),
        });
      }
    }
  }

  // Set by V8_COVERAGE in the webview vitest config; coverage instrumentation makes the timing unreliable.
  const underCoverage = process.env.FPU_V8_COVERAGE === "1";

  it("routes the 60-node, 120-edge fixture in under 500 ms", () => {
    expect(tableRoutes).toHaveLength(120);
    const started = performance.now();
    const result = routeGutters({
      focus: name(2, 0),
      boxes,
      rowOf,
      generation,
      layeredBounds: { left: 0, right: COLUMNS * 320 },
      tableRoutes,
      columnRoutes: [],
      relationshipRoutes: [],
      traceOn: false,
    });
    const elapsed = performance.now() - started;

    expect(result.paths.size).toBe(120);
    for (const edge of tableRoutes) {
      expect(result.paths.get(edge.id)?.d).not.toMatch(/NaN|Infinity/);
    }
    if (!underCoverage) {
      expect(elapsed, `routeGutters took ${elapsed} ms`).toBeLessThan(500);
    }
  });
});
