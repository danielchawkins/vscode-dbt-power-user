import { describe, expect, it } from "vitest";
import {
  lineageLayersDrawnEdges,
  lineageLayersStart,
  lineageLayersTables,
} from "../../../test/fixtures/lineageLayers";
import { toFlow } from "../flow";
import { engineFor } from "./engines";
import { createLayouter, freshLayouter } from "./layoutCache";
import type {
  LayoutEngine,
  LayoutRequest,
  LayoutResponse,
} from "./layoutEngine";
import type { FlowDecoration, LayoutInput } from "./layoutRequest";

/** A one-card request whose width is `width`; the request's content, and so its key, follows the width. */
const request = (width: number, focus = "a"): LayoutRequest => ({
  focus,
  cards: [{ id: "a", width, height: 56, tag: "staging" }],
  edges: [],
  rankPairs: [],
  traceOn: false,
});

/** An engine that records each request and answers with its call number as the hints. */
const recordingEngine = (requests: LayoutRequest[]): LayoutEngine => ({
  id: "graph-layout",
  layout: (req): LayoutResponse => {
    requests.push(req);
    return {
      positions: new Map(),
      bands: [],
      edges: new Map(),
      hints: { engine: "graph-layout", data: requests.length },
    };
  },
});

describe("createLayouter", () => {
  it("returns the cached result for the same content without calling the engine again", () => {
    const requests: LayoutRequest[] = [];
    const layout = createLayouter(() => recordingEngine(requests));
    const first = layout(request(280), "balanced");
    const again = layout(request(280), "balanced");
    expect(requests).toHaveLength(1);
    expect(again).toBe(first);
  });

  it("lays out again when the content or the engine differs", () => {
    const requests: LayoutRequest[] = [];
    const layout = createLayouter(() => recordingEngine(requests));
    layout(request(280), "balanced");
    layout(request(300), "balanced");
    layout(request(300), "thorough");
    expect(requests).toHaveLength(3);
  });

  it("lays out again when the spacing differs, seeded with the hints on screen", () => {
    const requests: LayoutRequest[] = [];
    const layout = createLayouter(() => recordingEngine(requests));
    const first = layout({ ...request(280), spacing: "default" }, "balanced");
    const compact = layout({ ...request(280), spacing: "compact" }, "balanced");
    expect(requests).toHaveLength(2);
    expect(requests[1]?.spacing).toBe("compact");
    expect(requests[1]?.previous).toEqual(first.hints);
    expect(compact).not.toBe(first);
  });

  it("keeps the least recently used results and lays out the one it dropped again", () => {
    const requests: LayoutRequest[] = [];
    const layout = createLayouter(() => recordingEngine(requests), 2);
    layout(request(280), "balanced"); // A
    layout(request(300), "balanced"); // B
    layout(request(280), "balanced"); // A is a hit, and is now the newest
    layout(request(320), "balanced"); // C drops B, the least recently used
    expect(requests).toHaveLength(3);
    layout(request(280), "balanced");
    expect(requests).toHaveLength(3);
    layout(request(300), "balanced");
    expect(requests).toHaveLength(4);
  });

  it("seeds a layout with the result on screen when it has the same start card", () => {
    const requests: LayoutRequest[] = [];
    const layout = createLayouter(() => recordingEngine(requests));
    const first = layout(request(280, "a"), "balanced");
    layout(request(300, "a"), "balanced");
    layout(request(320, "z"), "balanced");
    expect(requests[0]?.previous).toBeUndefined();
    expect(requests[1]?.previous).toBe(first.hints);
    expect(requests[2]?.previous).toBeUndefined();
  });
});

/** The lineage-layers fixture as the panel draws it: card ids, and the drawn edges between them. */
const cardOf = (id: string) => id.split(".").at(-1) ?? id;
const fixtureTables = lineageLayersTables
  .filter((table) => !table.hidden)
  .map((table) => ({ ...table, table: cardOf(table.table) }));
const fixtureEdges = lineageLayersDrawnEdges.map(
  ([parent, child]) => [cardOf(parent), cardOf(child)] as [string, string],
);
const UPSTREAM = [
  "int_orders__enriched",
  "stg_shop__orders",
  "stg_backend__accounts",
  "stg_backend__users",
  "orders",
  "country_codes",
];

/** The layout input of the tables in `keep`, and the edges between them. */
const viewOf = (keep: readonly string[]): LayoutInput => {
  const kept = new Set(keep);
  return {
    data: {
      start: cardOf(lineageLayersStart),
      tables: fixtureTables.filter((t) => kept.has(t.table)),
      edges: fixtureEdges.filter(([p, c]) => kept.has(p) && kept.has(c)),
      columnEdges: [],
    },
    columns: {},
    columnTables: [],
    refs: [],
  };
};

const decoration: FlowDecoration = { expansions: [], errors: {} };

/** The table cards' top-left corners by id. */
const cardPositions = (input: LayoutInput, layouter = freshLayouter) =>
  new Map(
    toFlow(input, decoration, layouter)
      .nodes.filter((node) => node.type === "table")
      .map((node) => [node.id, node.position]),
  );

describe("layout of the lineage fixture", () => {
  it("lays out the same view once, whatever the number of times it is drawn", () => {
    let engineCalls = 0;
    const layouter = createLayouter((engine) => {
      engineCalls += 1;
      return engineFor(engine);
    });
    const view = viewOf(fixtureTables.map((t) => t.table));
    const first = cardPositions(view, layouter);
    const again = cardPositions(view, layouter);
    expect(engineCalls).toBe(1);
    expect(again).toEqual(first);
  });

  it("moves the cards an expansion keeps less when the layout is seeded with the view on screen", () => {
    const before = viewOf(UPSTREAM);
    const after = viewOf(fixtureTables.map((t) => t.table));
    const kept = before.data.tables.map((t) => t.table);

    const seeded = createLayouter();
    const shown = cardPositions(before, seeded);
    const withHints = cardPositions(after, seeded);
    const withoutHints = cardPositions(after);

    const moved = (positions: Map<string, { x: number; y: number }>) =>
      kept.reduce((sum, id) => {
        const was = shown.get(id);
        const now = positions.get(id);
        return (
          sum +
          Math.abs((now?.x ?? 0) - (was?.x ?? 0)) +
          Math.abs((now?.y ?? 0) - (was?.y ?? 0))
        );
      }, 0);
    expect(moved(withHints)).toBeLessThan(moved(withoutHints));
  });
});
