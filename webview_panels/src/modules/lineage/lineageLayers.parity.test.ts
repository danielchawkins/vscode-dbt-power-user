import { describe, expect, it } from "vitest";
import {
  lineageLayersEdges,
  lineageLayersIds,
  lineageLayersKnown,
  lineageLayersRefs,
  lineageLayersTables,
} from "../../test/fixtures/lineageLayers";
import { relationshipEdgeId, tableEdgeId } from "./edgeIds";
import { fitGraph, fitPadding } from "./fit";
import type { TableRoute } from "./gutterRouter";
import { hiddenTables } from "./hiddenNodes";
import { type LayeredNode, layerTagOf, OTHER_TAG } from "./layered";
import { layeredFlow, type LayeredFlow } from "./layeredFlow";
import { geometry, tableHeight } from "./layout";
import { ZOOM_OUT_BELOW } from "./semanticZoom";

const {
  SOURCE,
  SEED,
  STG_ORDERS,
  STG_ACCOUNTS,
  STG_USERS,
  INT_ORDERS,
  DIM_CUSTOMERS,
  FCT_ORDERS,
  REV_DAILY,
  AUDIT_LOG,
} = lineageLayersIds;

type Connections = "dbt" | "declared" | "both";

type Placement = { row: number; side: "left" | "right" | "centre" };

const nodes: LayeredNode[] = lineageLayersTables.map((table) => ({
  id: table.table,
  width: geometry.tableWidth,
  height: tableHeight(undefined, 0, table.table === INT_ORDERS),
  tag: layerTagOf(table.nodeType, table.layer),
}));

/**
 * The dbt edges the panel draws: the panel leaves out the edges of hidden tables (`edgesAmong` in graph.ts), so the
 * hidden flag is read from the same map the panel reads.
 */
const hidden = hiddenTables({ known: lineageLayersKnown, start: INT_ORDERS });
const drawnDbtEdges = lineageLayersEdges.filter(
  ([parent, child]) => !hidden.has(parent) && !hidden.has(child),
);

/** Runs the real layered layout and gutter router, with the inputs `placeLayered` gives them. */
function layout(
  connections: Connections,
  dbtEdges = drawnDbtEdges,
): LayeredFlow {
  const dbt = connections !== "declared";
  const declared = connections !== "dbt";
  const tableRoutes: TableRoute[] = dbt
    ? dbtEdges.map(([parent, child]) => ({
        id: tableEdgeId(parent, child),
        parent,
        child,
      }))
    : [];
  return layeredFlow({
    start: INT_ORDERS,
    nodes,
    tableRoutes,
    // As `rankingEdges` in flow.ts: the dbt edges rank the cards when they are drawn. Under `declared` alone the
    // relationships rank them, the referenced table upstream of the declaring one. The gallery ranks by its dbt
    // edges under every setting, so its `declared` rows differ; see docs/lineage-layout.md.
    rankEdges: dbt
      ? dbtEdges
      : lineageLayersRefs.map((ref) => [ref.to.table, ref.from.table] as const),
    columnRoutes: [],
    relationshipRoutes: declared
      ? lineageLayersRefs.map((ref) => ({
          id: relationshipEdgeId(ref.id),
          from: ref.from.table,
          to: ref.to.table,
        }))
      : [],
    traceOn: false,
  });
}

/**
 * The focus card's centre x, and the corridor's: the centre of the span from the outer edge of the left group to the
 * outer edge of the right group, the layered cards other than the focus. The Other column is left out of the span.
 */
function focusCentres(flow: LayeredFlow): { focus: number; corridor: number } {
  const layered = nodes.filter(
    (node) => node.tag !== OTHER_TAG && node.id !== INT_ORDERS,
  );
  const lefts = layered.map((node) => flow.positions.get(node.id)?.x ?? 0);
  const rights = layered.map((node, index) => (lefts[index] ?? 0) + node.width);
  const focusX = flow.positions.get(INT_ORDERS)?.x ?? Number.NaN;
  return {
    focus: focusX + geometry.tableWidth / 2,
    corridor: (Math.min(...lefts) + Math.max(...rights)) / 2,
  };
}

const yOf = (flow: LayeredFlow, id: string): number =>
  flow.positions.get(id)?.y ?? Number.NaN;

/**
 * Where each card lands, read from the placed positions. The row is the card's sub-row counted from the top: the
 * cards of one row share a centre line, since `stackRows` in layered.ts centres each card in its row. The side is
 * `left` or `right` of the start card's centre line, which the corridor splits; the Other column is on one side of
 * it too, and `centre` is the start card itself.
 */
function placementOf(flow: LayeredFlow): Record<string, Placement> {
  const centres = new Map(
    nodes.map((node) => {
      const at = flow.positions.get(node.id);
      return [
        node.id,
        {
          x: (at?.x ?? Number.NaN) + node.width / 2,
          y: (at?.y ?? Number.NaN) + node.height / 2,
        },
      ] as const;
    }),
  );
  const rows = [
    ...new Set(Array.from(centres.values(), (c) => Math.round(c.y))),
  ].sort((a, b) => a - b);
  const startX = centres.get(INT_ORDERS)?.x ?? Number.NaN;
  return Object.fromEntries(
    nodes.map((node) => {
      const c = centres.get(node.id) ?? { x: Number.NaN, y: Number.NaN };
      const side =
        Math.abs(c.x - startX) < 0.5
          ? "centre"
          : c.x < startX
            ? "left"
            : "right";
      return [node.id, { row: rows.indexOf(Math.round(c.y)), side }];
    }),
  );
}

describe("lineage-layers fixture, table mode", () => {
  it("draws the dbt edges the panel draws, with the hidden audit_log edge left out", () => {
    expect(hidden).toEqual(new Set([AUDIT_LOG]));
    expect(drawnDbtEdges).toHaveLength(11);
    expect(lineageLayersEdges).toHaveLength(12);
  });

  it("lays the bands out source, staging, intermediate, marts, with Other beside them", () => {
    const flow = layout("dbt");
    const layered = flow.bands.filter((band) => band.tag !== "other");
    expect(layered.map((band) => band.tag)).toEqual([
      "source",
      "staging",
      "intermediate",
      "marts",
    ]);
    // Bands run top to bottom in that order.
    const tops = layered.map((band) => band.y);
    expect(tops.toSorted((a, b) => a - b)).toEqual(tops);
    const other = flow.bands.find((band) => band.tag === "other");
    expect(other).toBeDefined();
    // The Other column sits beside the layered bands, not between two of them.
    const left = Math.min(...layered.map((band) => band.x));
    const right = Math.max(...layered.map((band) => band.x + band.width));
    expect(other && (other.x + other.width <= left || other.x >= right)).toBe(
      true,
    );
  });

  it("puts the start node in intermediate and the source and seed on one row", () => {
    const flow = layout("dbt");
    expect(yOf(flow, SOURCE)).toBe(yOf(flow, SEED));
    expect(yOf(flow, STG_ORDERS)).toBeGreaterThan(yOf(flow, SOURCE));
    expect(yOf(flow, INT_ORDERS)).toBeGreaterThan(yOf(flow, STG_ORDERS));
    expect(yOf(flow, DIM_CUSTOMERS)).toBeGreaterThan(yOf(flow, INT_ORDERS));
    expect(yOf(flow, FCT_ORDERS)).toBeGreaterThan(yOf(flow, INT_ORDERS));
    expect(yOf(flow, REV_DAILY)).toBeGreaterThan(yOf(flow, INT_ORDERS));
  });

  it("counts the crossings and hops of dbt dependency edges", () => {
    // Three edges skip a row whose card sits over the corridor, so they go round it and cross other edges; drawn
    // through the corridor they would run under that card.
    const flow = layout("dbt");
    expect({ crossings: flow.crossings, hops: flow.hops }).toEqual({
      crossings: 3,
      hops: 3,
    });
  });

  it("puts each card inside the band of its layer, and the untagged audit_log in Other", () => {
    const flow = layout("dbt");
    const expected: [string, string][] = [
      [SOURCE, "source"],
      [SEED, "source"],
      [STG_ORDERS, "staging"],
      [STG_ACCOUNTS, "staging"],
      [STG_USERS, "staging"],
      [INT_ORDERS, "intermediate"],
      [DIM_CUSTOMERS, "marts"],
      [FCT_ORDERS, "marts"],
      [REV_DAILY, "marts"],
      [AUDIT_LOG, "other"],
    ];
    for (const [id, tag] of expected) {
      const band = flow.bands.find((b) => b.tag === tag);
      const y = yOf(flow, id);
      const top = band?.y ?? Number.NaN;
      const inBand = y >= top && y < top + (band?.height ?? 0);
      expect({ id, inBand }).toEqual({ id, inBand: true });
    }
  });

  it("centres the focus card between the left and right card groups", () => {
    for (const connections of ["dbt", "declared", "both"] as const) {
      const { focus, corridor } = focusCentres(layout(connections));
      expect({ connections, focus }).toEqual({
        connections,
        focus: corridor,
      });
    }
  });

  it("places each dbt card on the gallery's row, and on its side except three", () => {
    // Rows from the top match the gallery's: 0 the source and seed, 1 staging, 2 the start card, 3 the marts the
    // start feeds and audit_log, 4 fct_orders. Three sides differ, mirrored: the gallery puts a card with no offset
    // from the start on the right, and `splitSides` in layered.ts puts it on the lighter side.
    // See docs/lineage-layout.md.
    expect(placementOf(layout("dbt"))).toEqual({
      [SOURCE]: { row: 0, side: "left" },
      [SEED]: { row: 0, side: "right" },
      [STG_ORDERS]: { row: 1, side: "left" },
      [STG_ACCOUNTS]: { row: 1, side: "left" },
      [STG_USERS]: { row: 1, side: "right" },
      [INT_ORDERS]: { row: 2, side: "centre" },
      [DIM_CUSTOMERS]: { row: 3, side: "left" },
      [REV_DAILY]: { row: 3, side: "right" },
      [AUDIT_LOG]: { row: 3, side: "left" },
      [FCT_ORDERS]: { row: 4, side: "left" },
    });
  });
});

describe("lineage-layers fixture, declared and both", () => {
  // The gallery's counts, measured in a live Chromium run of designs.html (design M, round 2, table mode; see
  // docs/lineage-layout.md): dbt 12 edges, 0 crossings, 0 hops; declared 5 edges, 1 crossing, 1 hop; both 17
  // edges, 13 crossings, 8 hops. Its crossings count table and relationship paths together; table paths alone give 0
  // under both. The panel's values below: declared 0 and 0, both 12 and 7.
  it("counts the crossings and hops of declared relationships only", () => {
    const flow = layout("declared");
    expect({ crossings: flow.crossings, hops: flow.hops }).toEqual({
      crossings: 0,
      hops: 0,
    });
  });

  it("counts the crossings and hops with dbt and declared drawn together", () => {
    const flow = layout("both");
    expect({ crossings: flow.crossings, hops: flow.hops }).toEqual({
      crossings: 12,
      hops: 7,
    });
  });

  it("counts the crossings and hops when the hidden audit_log edge is drawn too", () => {
    // The gallery draws this edge as well, so these are the counts to set against its 13 crossings and 8 hops.
    const flow = layout("both", lineageLayersEdges);
    expect({ crossings: flow.crossings, hops: flow.hops }).toEqual({
      crossings: 13,
      hops: 8,
    });
  });

  it("places the cards on the dbt rows when dbt and declared are drawn together", () => {
    // Rows and sides match the dbt layout. The gallery's rows match too; its sides differ in the same three cards.
    expect(placementOf(layout("both"))).toEqual({
      [SOURCE]: { row: 0, side: "left" },
      [SEED]: { row: 0, side: "right" },
      [STG_ORDERS]: { row: 1, side: "left" },
      [STG_ACCOUNTS]: { row: 1, side: "left" },
      [STG_USERS]: { row: 1, side: "right" },
      [INT_ORDERS]: { row: 2, side: "centre" },
      [DIM_CUSTOMERS]: { row: 3, side: "left" },
      [REV_DAILY]: { row: 3, side: "right" },
      [AUDIT_LOG]: { row: 3, side: "left" },
      [FCT_ORDERS]: { row: 4, side: "left" },
    });
  });

  it("places the cards by the relationships when declared alone draws them", () => {
    // The gallery keeps its dbt rows under `declared`; the panel ranks by the relationships, so the rows differ.
    // These are the panel's values; see "Declared-only rows" in docs/lineage-layout.md.
    expect(placementOf(layout("declared"))).toEqual({
      [SOURCE]: { row: 5, side: "right" },
      [SEED]: { row: 2, side: "left" },
      [STG_ORDERS]: { row: 3, side: "right" },
      [STG_ACCOUNTS]: { row: 6, side: "left" },
      [STG_USERS]: { row: 3, side: "left" },
      [INT_ORDERS]: { row: 1, side: "centre" },
      [DIM_CUSTOMERS]: { row: 0, side: "left" },
      [REV_DAILY]: { row: 4, side: "right" },
      [AUDIT_LOG]: { row: 2, side: "left" },
      [FCT_ORDERS]: { row: 4, side: "left" },
    });
  });
});

/** The ids of the cards whose centre lies in the band tagged `tag`. */
function cardsIn(flow: LayeredFlow, tag: string): string[] {
  const band = flow.bands.find((b) => b.tag === tag);
  return nodes
    .filter((node) => {
      const at = flow.positions.get(node.id);
      const x = (at?.x ?? Number.NaN) + node.width / 2;
      return band !== undefined && x >= band.x && x <= band.x + band.width;
    })
    .map((node) => node.id);
}

/**
 * The flow nodes the panel fits: the cards and the bands, as `toFlow` gives them, at the sizes `layeredFlow` lays them
 * out with. A fake React Flow records the viewport a layered fit sets.
 */
async function fitWithin(width: number, height: number) {
  const flow = layout("dbt");
  const cards = nodes.map((node) => ({
    id: node.id,
    type: "table",
    position: flow.positions.get(node.id) ?? { x: 0, y: 0 },
    data: {},
    measured: { width: node.width, height: node.height },
  }));
  const bands = flow.bands.map((band) => ({
    id: `band:${band.tag}`,
    type: "band",
    position: { x: band.x, y: band.y },
    data: { tag: band.tag },
    measured: { width: band.width, height: band.height },
  }));
  const all = [...bands, ...cards];
  const views: { x: number; zoom: number }[] = [];
  const fake = {
    fitView: async () => undefined,
    getNode: (id: string) => all.find((node) => node.id === id),
    getNodes: () => all,
    setViewport: async (view: { x: number; zoom: number }) => {
      views.push(view);
    },
  };
  await fitGraph({
    flow: fake as never,
    options: {},
    padding: fitPadding(),
    width,
    height,
    layered: true,
    focusId: INT_ORDERS,
  });
  const view = views.at(-1);
  if (view === undefined) {
    throw new Error("a layered fit sets the viewport");
  }
  const left = (id: string) => {
    const card = cards.find((c) => c.id === id);
    return view.x + (card?.position.x ?? Number.NaN) * view.zoom;
  };
  const right = (id: string) => left(id) + geometry.tableWidth * view.zoom;
  return { view, left, right, flow };
}

describe("lineage-layers fixture, the layered fit", () => {
  it("keeps every Other card whole on screen in a narrow canvas", async () => {
    const padding = fitPadding();
    // Narrow enough that the fit is near the minimum zoom, and wide enough that the Other column still fits.
    const width = 760;
    const { view, flow, left, right } = await fitWithin(width, 600);
    expect(view.zoom).toBeGreaterThanOrEqual(ZOOM_OUT_BELOW);
    // With room to spare the same graph fits at a higher zoom.
    const roomier = await fitWithin(1400, 600);
    expect(roomier.view.zoom).toBeGreaterThan(view.zoom);
    const otherIds = cardsIn(flow, OTHER_TAG);
    expect(otherIds.length).toBeGreaterThan(0);
    for (const id of otherIds) {
      expect(left(id)).toBeGreaterThanOrEqual(padding.left - 1e-6);
      expect(right(id)).toBeLessThanOrEqual(width - padding.right + 1e-6);
    }
  });

  it("keeps the focus and the main bands on screen when the Other column cannot fit as well", async () => {
    const padding = fitPadding();
    const width = 700;
    const { flow, left, right } = await fitWithin(width, 600);
    const mainIds = nodes
      .map((node) => node.id)
      .filter((id) => !cardsIn(flow, OTHER_TAG).includes(id));
    for (const id of mainIds) {
      expect(left(id)).toBeGreaterThanOrEqual(padding.left - 1e-6);
      expect(right(id)).toBeLessThanOrEqual(width - padding.right + 1e-6);
    }
  });
});

describe("lineage-layers fixture, edges and cards", () => {
  /** The paths' vertical runs that pass through a card other than the two the path joins. */
  function edgesUnderCards(flow: LayeredFlow): string[] {
    const size = new Map(nodes.map((node) => [node.id, node]));
    const ends = (id: string): string[] => {
      const route = drawnDbtEdges.find(([p, c]) => id === tableEdgeId(p, c));
      const ref = lineageLayersRefs.find(
        (r) => id === relationshipEdgeId(r.id),
      );
      return route ? [...route] : ref ? [ref.from.table, ref.to.table] : [];
    };
    const hits: string[] = [];
    for (const [id, path] of flow.paths) {
      const points = (path.d.match(/[MLQA][^MLQA]*/g) ?? []).map((command) => {
        const n = Array.from(command.matchAll(/-?[\d.]+/g), (m) =>
          Number(m[0]),
        );
        return { x: n.at(-2) ?? 0, y: n.at(-1) ?? 0 };
      });
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!;
        const b = points[i]!;
        if (Math.abs(a.x - b.x) > 0.01) continue;
        for (const [card, at] of flow.positions) {
          const box = size.get(card);
          if (!box || ends(id).includes(card)) continue;
          const inX = a.x > at.x && a.x < at.x + box.width;
          const inY =
            Math.min(a.y, b.y) < at.y + box.height && Math.max(a.y, b.y) > at.y;
          if (inX && inY) hits.push(`${id} under ${card}`);
        }
      }
    }
    return hits;
  }

  it.each(["dbt", "declared", "both"] as const)(
    "draws no %s edge under a card it does not join",
    (connections) => {
      expect(edgesUnderCards(layout(connections))).toEqual([]);
    },
  );
});
