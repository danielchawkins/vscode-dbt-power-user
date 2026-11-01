import { layout } from "@fusion-power-user/graph-layout";
import type * as GraphLayout from "@fusion-power-user/graph-layout";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { graphLayoutEngine } from "./graphLayoutEngine";
import type { LayoutCard, LayoutRequest } from "./layoutEngine";

// The package's `layout` stays real; the spy records the options each request was laid out with.
vi.mock("@fusion-power-user/graph-layout", async (importOriginal) => {
  const original = await importOriginal<typeof GraphLayout>();
  return { ...original, layout: vi.fn(original.layout) };
});

const CARDS: LayoutCard[] = [
  { id: "a", width: 280, height: 56, tag: "source" },
  { id: "b", width: 280, height: 56, tag: "staging" },
  { id: "c", width: 280, height: 66, tag: "marts" },
];

const REQUEST: LayoutRequest = {
  focus: "a",
  cards: CARDS,
  edges: [
    { id: "a>b", from: "a", to: "b", role: "table" },
    { id: "b>c", from: "b", to: "c", role: "table" },
  ],
  rankPairs: [
    ["a", "b"],
    ["b", "c"],
  ],
  traceOn: false,
};

/** The spacing the package was last asked to lay out with. */
const spacingOfLastCall = () => {
  const calls = vi.mocked(layout).mock.calls;
  return calls.at(-1)?.[1].spacing;
};

/** The default spacing the engine drew with before the Layout control existed. */
const DEFAULT_SPACING = { node: 28, rank: 36, edge: 6, cluster: 28 };

/** The compact spacing: each setting about 60 to 70 per cent of the default. */
const COMPACT_SPACING = { node: 18, rank: 24, edge: 4, cluster: 18 };

beforeEach(() => {
  vi.mocked(layout).mockClear();
});

describe("graphLayoutEngine spacing", () => {
  it("lays out a request with no spacing at the default spacing, unchanged", () => {
    graphLayoutEngine("balanced").layout(REQUEST);
    expect(spacingOfLastCall()).toEqual(DEFAULT_SPACING);
  });

  it("lays out a default request at the default spacing, unchanged", () => {
    graphLayoutEngine("balanced").layout({ ...REQUEST, spacing: "default" });
    expect(spacingOfLastCall()).toEqual(DEFAULT_SPACING);
  });

  it("lays out a compact request at the compact spacing", () => {
    graphLayoutEngine("balanced").layout({ ...REQUEST, spacing: "compact" });
    expect(spacingOfLastCall()).toEqual(COMPACT_SPACING);
  });

  it("keeps each compact setting about 60 to 70 per cent of the default", () => {
    for (const key of ["node", "rank", "edge", "cluster"] as const) {
      const ratio = COMPACT_SPACING[key] / DEFAULT_SPACING[key];
      expect(ratio, key).toBeGreaterThanOrEqual(0.6);
      expect(ratio, key).toBeLessThanOrEqual(0.7);
    }
  });

  it("draws the compact layout no wider than the default", () => {
    const widthOf = (spacing: LayoutRequest["spacing"]) => {
      const { positions } = graphLayoutEngine("balanced").layout({
        ...REQUEST,
        spacing,
      });
      return Math.max(...Array.from(positions.values(), (p) => p.x));
    };
    expect(widthOf("compact")).toBeLessThanOrEqual(widthOf("default"));
  });
});
