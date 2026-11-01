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
  LayoutAnswer,
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

/** The response of a layout that was drawn, not superseded. */
const drawn = async (
  answer: Promise<LayoutAnswer>,
): Promise<LayoutResponse> => {
  const settled = await answer;
  if (settled.superseded) {
    throw new Error("the layout was superseded");
  }
  return settled.response;
};

/** An engine that records each request and answers with its call number as the hints. */
const recordingEngine = (requests: LayoutRequest[]): LayoutEngine => ({
  id: "graph-layout",
  layout: async (req): Promise<LayoutAnswer> => {
    requests.push(req);
    return {
      superseded: false,
      response: {
        positions: new Map(),
        bands: [],
        edges: new Map(),
        hints: { engine: "graph-layout", data: requests.length },
        metrics: { crossings: 0, bends: 0, edgeLength: 0, area: 0 },
      },
    };
  },
});

/**
 * The panel's engine, held: each layout answers only when the test releases it, so the test picks the order the
 * answers come in. A release lays out the request with the real engine, so the answer is superseded if a newer
 * generation was asked for by then.
 */
const heldEngine = (held: (() => void)[]): LayoutEngine => {
  const real = engineFor("balanced");
  return {
    id: "graph-layout",
    layout: (req, generation) =>
      new Promise<LayoutAnswer>((resolve) => {
        held.push(() => resolve(real.layout(req, generation)));
      }),
  };
};

describe("createLayouter", () => {
  it("returns the cached result for the same content without calling the engine again", async () => {
    const requests: LayoutRequest[] = [];
    const layout = createLayouter(() => recordingEngine(requests));
    const first = await drawn(layout(request(280), "balanced"));
    const again = await drawn(layout(request(280), "balanced"));
    expect(requests).toHaveLength(1);
    expect(again).toBe(first);
  });

  it("lays out again when the content or the engine differs", async () => {
    const requests: LayoutRequest[] = [];
    const layout = createLayouter(() => recordingEngine(requests));
    await layout(request(280), "balanced");
    await layout(request(300), "balanced");
    await layout(request(300), "thorough");
    expect(requests).toHaveLength(3);
  });

  it("lays out again when the spacing differs, seeded with the hints on screen", async () => {
    const requests: LayoutRequest[] = [];
    const layout = createLayouter(() => recordingEngine(requests));
    const first = await drawn(
      layout({ ...request(280), spacing: "default" }, "balanced"),
    );
    const compact = await drawn(
      layout({ ...request(280), spacing: "compact" }, "balanced"),
    );
    expect(requests).toHaveLength(2);
    expect(requests[1]?.spacing).toBe("compact");
    expect(requests[1]?.previous).toEqual(first.hints);
    expect(compact).not.toBe(first);
  });

  it("keeps the least recently used results and lays out the one it dropped again", async () => {
    const requests: LayoutRequest[] = [];
    const layout = createLayouter(() => recordingEngine(requests), 2);
    await layout(request(280), "balanced"); // A
    await layout(request(300), "balanced"); // B
    await layout(request(280), "balanced"); // A is a hit, and is now the newest
    await layout(request(320), "balanced"); // C drops B, the least recently used
    expect(requests).toHaveLength(3);
    await layout(request(280), "balanced");
    expect(requests).toHaveLength(3);
    await layout(request(300), "balanced");
    expect(requests).toHaveLength(4);
  });

  it("seeds a layout with the result on screen when it has the same start card", async () => {
    const requests: LayoutRequest[] = [];
    const layout = createLayouter(() => recordingEngine(requests));
    const first = await drawn(layout(request(280, "a"), "balanced"));
    await layout(request(300, "a"), "balanced");
    await layout(request(320, "z"), "balanced");
    expect(requests[0]?.previous).toBeUndefined();
    expect(requests[1]?.previous).toBe(first.hints);
    expect(requests[2]?.previous).toBeUndefined();
  });

  it("drops an older layout that answers after a newer one was asked for", async () => {
    const held: (() => void)[] = [];
    const layout = createLayouter(() => heldEngine(held));
    const older = layout(request(280), "balanced");
    const newer = layout(request(300), "balanced");
    held[1]!();
    held[0]!();
    expect((await older).superseded).toBe(true);
    expect((await newer).superseded).toBe(false);
  });

  it("seeds the next layout from the newest drawn answer, not from an older one that answered later", async () => {
    const held: (() => void)[] = [];
    const requests: LayoutRequest[] = [];
    const layout = createLayouter((engine) =>
      engine === "balanced" ? heldEngine(held) : recordingEngine(requests),
    );
    const older = layout(request(280, "a"), "balanced");
    const newer = layout(request(300, "a"), "balanced");
    held[1]!();
    const shown = await drawn(newer);
    held[0]!();
    expect((await older).superseded).toBe(true);
    await layout(request(320, "a"), "thorough");
    expect(requests[0]?.previous).toBe(shown.hints);
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
const cardPositions = async (input: LayoutInput, layouter = freshLayouter) => {
  const flow = await toFlow(input, decoration, layouter);
  if (!flow) {
    throw new Error("the layout was superseded");
  }
  return new Map(
    flow.nodes
      .filter((node) => node.type === "table")
      .map((node) => [node.id, node.position]),
  );
};

describe("layout of the lineage fixture", () => {
  it("lays out the same view once, whatever the number of times it is drawn", async () => {
    let engineCalls = 0;
    const layouter = createLayouter((engine) => {
      engineCalls += 1;
      return engineFor(engine);
    });
    const view = viewOf(fixtureTables.map((t) => t.table));
    const first = await cardPositions(view, layouter);
    const again = await cardPositions(view, layouter);
    expect(engineCalls).toBe(1);
    expect(again).toEqual(first);
  });

  it("draws the latest layout when an older one answers after it, and drops the older", async () => {
    const held: (() => void)[] = [];
    const layouter = createLayouter(() => heldEngine(held));
    const all = fixtureTables.map((t) => t.table);
    const older = toFlow(viewOf(UPSTREAM), decoration, layouter);
    const newer = toFlow(viewOf(all), decoration, layouter);
    held[1]!();
    held[0]!();
    expect(await older).toBeUndefined();
    const flow = await newer;
    expect(
      flow?.nodes.filter((node) => node.type === "table").map((n) => n.id),
    ).toEqual(expect.arrayContaining(all));
  });

  it("moves the cards an expansion keeps less when the layout is seeded with the view on screen", async () => {
    const before = viewOf(UPSTREAM);
    const after = viewOf(fixtureTables.map((t) => t.table));
    const kept = before.data.tables.map((t) => t.table);

    const seeded = createLayouter();
    const shown = await cardPositions(before, seeded);
    const withHints = await cardPositions(after, seeded);
    const withoutHints = await cardPositions(after);

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
