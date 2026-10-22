import { describe, expect, it } from "vitest";
import {
  BAND_PAD,
  CARD_GAP,
  CORRIDOR,
  GUTTER,
  layerTagOf,
  layoutLayered,
  type LayeredNode,
} from "./layered";

/** The gap between two sub-rows in one band, as the layout draws it. */
const SAME_ROW = 58;

const WIDTH = 280;
const HEIGHT = 100;

const node = (id: string, tag: string): LayeredNode => ({
  id,
  width: WIDTH,
  height: HEIGHT,
  tag,
});

const yOf = (plan: ReturnType<typeof layoutLayered>, id: string): number =>
  plan.positions.get(id)?.y ?? NaN;
const xOf = (plan: ReturnType<typeof layoutLayered>, id: string): number =>
  plan.positions.get(id)?.x ?? NaN;
const centreOf = (plan: ReturnType<typeof layoutLayered>, id: string): number =>
  xOf(plan, id) + WIDTH / 2;

describe("layerTagOf", () => {
  it("puts sources and seeds in the source band", () => {
    expect(layerTagOf("source", undefined)).toBe("source");
    expect(layerTagOf("seed", "marts")).toBe("source");
  });

  it("uses the table layer, and falls back to other when there is none", () => {
    expect(layerTagOf("model", "staging")).toBe("staging");
    expect(layerTagOf("model", undefined)).toBe("other");
    expect(layerTagOf("model", "")).toBe("other");
  });
});

describe("layoutLayered rows", () => {
  // src -> stg -> start -> mart, with a shortcut src -> start: src sits two generations above the start.
  const nodes = [
    node("src", "source"),
    node("stg", "staging"),
    node("start", "intermediate"),
    node("mart", "marts"),
  ];
  const edges: [string, string][] = [
    ["src", "stg"],
    ["stg", "start"],
    ["src", "start"],
    ["start", "mart"],
  ];

  it("puts parents above and children below, by longest path from the start", () => {
    const plan = layoutLayered("start", nodes, edges, 1);
    expect(plan.generation.get("src")).toBe(-2);
    expect(plan.generation.get("stg")).toBe(-1);
    expect(plan.generation.get("start")).toBe(0);
    expect(plan.generation.get("mart")).toBe(1);
    expect(yOf(plan, "src")).toBeLessThan(yOf(plan, "stg"));
    expect(yOf(plan, "stg")).toBeLessThan(yOf(plan, "start"));
    expect(yOf(plan, "start")).toBeLessThan(yOf(plan, "mart"));
    expect(plan.focusRow).toBe(2);
  });

  it("draws one band per run of same-layer rows, each reaching BAND_PAD past its cards", () => {
    const plan = layoutLayered("start", nodes, edges, 1);
    expect(plan.bands.map((band) => band.tag)).toEqual([
      "source",
      "staging",
      "intermediate",
      "marts",
    ]);
    const start = plan.bands[2];
    expect(start?.y).toBe(yOf(plan, "start") - BAND_PAD);
    expect(start?.height).toBe(HEIGHT + 2 * BAND_PAD);
    expect(start?.x).toBe(
      Math.min(...nodes.map((n) => xOf(plan, n.id))) - BAND_PAD,
    );
  });

  it("leaves a GUTTER of bare canvas between two bands", () => {
    const plan = layoutLayered("start", nodes, edges, 1);
    for (let index = 0; index + 1 < plan.bands.length; index++) {
      const band = plan.bands[index];
      const next = plan.bands[index + 1];
      expect((next?.y ?? 0) - ((band?.y ?? 0) + (band?.height ?? 0))).toBe(
        GUTTER,
      );
    }
  });

  it("splits a generation into one sub-row per layer, in layer order", () => {
    const plan = layoutLayered(
      "start",
      [
        node("start", "intermediate"),
        node("int2", "intermediate"),
        node("mart", "marts"),
      ],
      [
        ["start", "int2"],
        ["start", "mart"],
      ],
      1,
    );
    expect(plan.rowOf.get("int2")).toBeLessThan(plan.rowOf.get("mart") ?? -1);
    expect(yOf(plan, "int2")).toBeLessThan(yOf(plan, "mart"));
    expect(plan.bands.map((band) => band.tag)).toEqual([
      "intermediate",
      "marts",
    ]);
  });

  it("merges adjacent same-layer sub-rows when no edge joins them", () => {
    // src1 sits two generations up, seed one generation up; neither edge joins them, so they share a row.
    const plan = layoutLayered(
      "start",
      [
        node("src1", "source"),
        node("seed", "source"),
        node("stg", "staging"),
        node("start", "intermediate"),
      ],
      [
        ["src1", "stg"],
        ["stg", "start"],
        ["seed", "start"],
      ],
      1,
    );
    expect(plan.rowOf.get("src1")).toBe(plan.rowOf.get("seed"));
    expect(yOf(plan, "src1")).toBe(yOf(plan, "seed"));
  });

  it("keeps same-layer sub-rows apart when an edge joins them, one band over both", () => {
    const plan = layoutLayered(
      "start",
      [node("a", "source"), node("b", "source"), node("start", "intermediate")],
      [
        ["a", "b"],
        ["b", "start"],
      ],
      1,
    );
    expect(plan.rowOf.get("a")).not.toBe(plan.rowOf.get("b"));
    expect(yOf(plan, "b") - yOf(plan, "a")).toBe(HEIGHT + SAME_ROW);
    expect(plan.bands[0]?.tag).toBe("source");
    expect(plan.bands[0]?.height).toBe(
      HEIGHT + SAME_ROW + HEIGHT + 2 * BAND_PAD,
    );
  });

  it("centres shorter cards vertically on their row", () => {
    const tall = { ...node("tall", "marts"), height: HEIGHT };
    const short = { ...node("short", "marts"), height: HEIGHT / 2 };
    const plan = layoutLayered(
      "start",
      [node("start", "intermediate"), tall, short],
      [
        ["start", "tall"],
        ["start", "short"],
      ],
      1,
    );
    expect(plan.rowOf.get("short")).toBe(plan.rowOf.get("tall"));
    const tallMid = yOf(plan, "tall") + HEIGHT / 2;
    const shortMid = yOf(plan, "short") + HEIGHT / 2 / 2;
    expect(shortMid).toBe(tallMid);
    expect(yOf(plan, "short")).toBeGreaterThan(yOf(plan, "tall"));
  });

  it("places a node that is neither above nor below the start just above its first child", () => {
    const plan = layoutLayered(
      "start",
      [
        node("start", "intermediate"),
        node("mart", "marts"),
        node("side", "staging"),
      ],
      [
        ["start", "mart"],
        ["side", "mart"],
      ],
      1,
    );
    expect(plan.generation.get("side")).toBe(-1);
    expect(yOf(plan, "side")).toBeLessThan(yOf(plan, "start"));
  });
});

describe("layoutLayered corridor", () => {
  it("keeps the start node on the centre line and every other card clear of the corridor", () => {
    const nodes = [
      node("p1", "source"),
      node("p2", "source"),
      node("start", "intermediate"),
      node("m1", "marts"),
      node("m2", "marts"),
      node("m3", "marts"),
      node("m4", "marts"),
    ];
    const edges: [string, string][] = [
      ["p1", "start"],
      ["p2", "start"],
      ["start", "m1"],
      ["start", "m2"],
      ["start", "m3"],
      ["start", "m4"],
    ];
    const plan = layoutLayered("start", nodes, edges, 1);
    const centre = centreOf(plan, "start");
    for (const id of ["p1", "p2", "m1", "m2", "m3", "m4"]) {
      const left = xOf(plan, id);
      const right = left + WIDTH;
      const clear =
        right <= centre - CORRIDOR / 2 || left >= centre + CORRIDOR / 2;
      expect(clear, `${id} overlaps the corridor`).toBe(true);
    }
  });

  it("orders cards either side of the corridor by their neighbours nearer the start", () => {
    const nodes = [
      node("start", "intermediate"),
      node("a", "marts"),
      node("b", "marts"),
    ];
    const edges: [string, string][] = [
      ["start", "a"],
      ["start", "b"],
    ];
    const plan = layoutLayered("start", nodes, edges, 1);
    expect(xOf(plan, "a")).not.toBe(xOf(plan, "b"));
    expect(Math.abs(xOf(plan, "a") - xOf(plan, "b"))).toBeGreaterThanOrEqual(
      WIDTH + CARD_GAP,
    );
  });
});

describe("layoutLayered Other column", () => {
  const nodes = [
    node("start", "intermediate"),
    node("misc", "other"),
    node("mart", "marts"),
  ];
  const edges: [string, string][] = [
    ["start", "misc"],
    ["start", "mart"],
  ];

  it("puts other nodes beyond the layered cards on the chosen side", () => {
    const right = layoutLayered("start", nodes, edges, 1);
    const layeredRight = Math.max(
      xOf(right, "start") + WIDTH,
      xOf(right, "mart") + WIDTH,
    );
    expect(xOf(right, "misc")).toBeGreaterThan(layeredRight);

    const left = layoutLayered("start", nodes, edges, -1);
    const layeredLeft = Math.min(xOf(left, "start"), xOf(left, "mart"));
    expect(xOf(left, "misc") + WIDTH).toBeLessThan(layeredLeft);
  });

  it("draws the Other band beside the layered bands, separated by a GUTTER", () => {
    const plan = layoutLayered("start", nodes, edges, 1);
    const other = plan.otherBand;
    expect(other).toBeDefined();
    const layeredRight = Math.max(
      ...plan.bands.map((band) => band.x + band.width),
    );
    expect((other?.x ?? 0) - layeredRight).toBe(GUTTER);
    expect(plan.layeredBounds.right).toBe(
      Math.max(xOf(plan, "start"), xOf(plan, "mart")) + WIDTH,
    );
  });

  it("omits the Other band when no node is untagged", () => {
    const plan = layoutLayered("start", [node("start", "intermediate")], [], 1);
    expect(plan.otherBand).toBeUndefined();
  });
});
