import { describe, expect, it } from "vitest";
import { graphLayoutEngine } from "./graphLayoutEngine";
import type {
  LayerBand,
  LayoutCard,
  LayoutRequest,
  Point,
} from "./layoutEngine";

/** The lineage-groups `hub` view: a model in Other above two staging groups and a mart in a third layer. */
const CARDS: LayoutCard[] = [
  { id: "hub", width: 280, height: 112, tag: "other" },
  { id: "a", width: 280, height: 56, tag: "staging" },
  { id: "b", width: 280, height: 56, tag: "staging" },
  { id: "summary_mart", width: 280, height: 66, tag: "marts" },
];

const REQUEST: LayoutRequest = {
  focus: "hub",
  cards: CARDS,
  edges: [
    { id: "hub>a", from: "hub", to: "a", role: "group" },
    { id: "hub>b", from: "hub", to: "b", role: "group" },
    { id: "hub>summary_mart", from: "hub", to: "summary_mart", role: "table" },
  ],
  rankPairs: [
    ["hub", "a"],
    ["hub", "b"],
    ["hub", "summary_mart"],
  ],
  traceOn: false,
};

const overlap = (a: LayerBand, b: LayerBand) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

/** Whether the segment from `p` to `q` touches the card's rectangle, borders included. */
function touches(p: Point, q: Point, card: LayerBand): boolean {
  const [x0, x1] = [Math.min(p.x, q.x), Math.max(p.x, q.x)];
  const [y0, y1] = [Math.min(p.y, q.y), Math.max(p.y, q.y)];
  return (
    x0 <= card.x + card.width &&
    card.x <= x1 &&
    y0 <= card.y + card.height &&
    card.y <= y1
  );
}

describe.each(["balanced", "thorough"] as const)(
  "graphLayoutEngine(%s)",
  (effort) => {
    const response = graphLayoutEngine(effort).layout(REQUEST);

    it("draws one band per layer, none overlapping another", () => {
      const bands = response.bands;
      expect(bands.map((band) => band.tag).toSorted()).toEqual([
        "marts",
        "other",
        "staging",
      ]);
      for (const [i, a] of bands.entries()) {
        for (const b of bands.slice(i + 1)) {
          expect(overlap(a, b), `${a.tag} overlaps ${b.tag}`).toBe(false);
        }
      }
    });

    it("keeps every card inside its layer's band", () => {
      for (const card of CARDS) {
        const at = response.positions.get(card.id)!;
        const band = response.bands.find((b) => b.tag === card.tag)!;
        expect(at.x).toBeGreaterThanOrEqual(band.x);
        expect(at.y).toBeGreaterThanOrEqual(band.y);
        expect(at.x + card.width).toBeLessThanOrEqual(band.x + band.width);
        expect(at.y + card.height).toBeLessThanOrEqual(band.y + band.height);
      }
    });

    it("routes no edge along or through a card it does not end at", () => {
      for (const edge of REQUEST.edges) {
        const points = response.edges.get(edge.id)!.points;
        for (const card of CARDS) {
          if (card.id === edge.from || card.id === edge.to) {
            continue;
          }
          const rect = { ...card, ...response.positions.get(card.id)! };
          points.slice(1).forEach((q, k) => {
            expect(
              touches(points[k]!, q, rect),
              `${edge.id} touches ${card.id}`,
            ).toBe(false);
          });
        }
      }
    });
  },
);

/**
 * The int__column_profiles view: a function in Other feeds staging, and a model in Other hangs off a mart. Other
 * is not a layer, so each Other card gets its own band where its edges put it, not one band spanning the drawing.
 */
describe("graphLayoutEngine with cards in Other", () => {
  const card = (id: string, tag: string): LayoutCard => ({
    id,
    width: 280,
    height: 56,
    tag,
  });
  const cards = [
    card("src", "source"),
    card("fn", "other"),
    card("stg", "staging"),
    card("int", "intermediate"),
    card("mart", "marts"),
    card("downstream", "other"),
  ];
  const pairs: [string, string][] = [
    ["src", "stg"],
    ["fn", "stg"],
    ["stg", "int"],
    ["int", "mart"],
    ["mart", "downstream"],
  ];
  const request: LayoutRequest = {
    focus: "int",
    cards,
    edges: pairs.map(([from, to]) => ({
      id: `${from}>${to}`,
      from,
      to,
      role: "table" as const,
    })),
    rankPairs: pairs,
    traceOn: false,
  };
  const response = graphLayoutEngine("balanced").layout(request);

  it("draws one small Other band per Other card, overlapping no other band", () => {
    const other = response.bands.filter((band) => band.tag === "other");
    expect(other).toHaveLength(2);
    for (const [i, a] of response.bands.entries()) {
      for (const b of response.bands.slice(i + 1)) {
        expect(overlap(a, b), `${a.tag} overlaps ${b.tag}`).toBe(false);
      }
    }
  });
});
