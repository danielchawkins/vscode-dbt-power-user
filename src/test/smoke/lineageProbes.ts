import * as assert from "node:assert";
import { evaluatePanel } from "./panelFrames";
import { PANELS } from "./panels";
import { cdpPort } from "./smokeEnv";

/** A lineage card's column list, the column edges traced from it, and the table edges' paths. */
export interface ColumnState {
  entry: string;
  columnTables: string[];
  cardColumns: number;
  traced: string[];
  tableD: string[];
}

/**
 * True once every card a traced column edge ends at lists its columns. Each traced card opens its list after the
 * click, one at a time, and every opening lays the graph out again, so table edge paths move until this holds.
 */
export const tracedCardsListed = (state: ColumnState): boolean =>
  state.traced.every((id) =>
    state.columnTables.includes(id.split("->")[1].split(".").at(-2) ?? ""),
  );

/** The script that reads the column state of the lineage card whose table id ends in `card`. */
const columnStateScript = (
  card: string,
) => `(() => document.body.dataset.entry === "lineage" ? {
  entry: "lineage",
  columnTables: [...document.querySelectorAll("[data-table]")]
    .filter((n) => n.querySelector("[data-testid=lineage-columns]"))
    .map((n) => n.dataset.table.split(".").at(-1)),
  cardColumns: document.querySelectorAll("[data-table$='.${card}'] [data-column]").length,
  traced: [...document.querySelectorAll(".react-flow__edge.lineage-column-edge")]
    .map((e) => e.getAttribute("data-id"))
    .sort(),
  tableD: [...document.querySelectorAll(".react-flow__edge.lineage-table-edge path")]
    .map((p) => p.getAttribute("d"))
    .sort(),
} : null)()`;

/** Clicks the button labelled `label` (text or aria-label) on the lineage card whose table id ends in `card`. */
export const clickOnCard = (card: string, label: string) => `(() => {
  if (document.body.dataset.entry !== "lineage") return null;
  const node = document.querySelector("[data-table$='.${card}']");
  const want = ${JSON.stringify(label)};
  const button = [...(node?.querySelectorAll("button") ?? [])].find(
    (b) => b.textContent.trim() === want || b.getAttribute("aria-label") === want,
  );
  button?.click();
  return { entry: "lineage", clicked: Boolean(button) };
})()`;

/** Clicks the first column row of the lineage card whose table id ends in `card`. */
export const clickFirstColumn = (card: string) => `(() => {
  if (document.body.dataset.entry !== "lineage") return null;
  const column = document.querySelector("[data-table$='.${card}'] [data-column]");
  column?.click();
  return { entry: "lineage", clicked: Boolean(column) };
})()`;

/** Reads the column state of the lineage card whose table id ends in `card`. */
export async function readColumns(card: string): Promise<ColumnState> {
  const match = await evaluatePanel<ColumnState>(
    cdpPort(),
    PANELS.lineage.entry,
    columnStateScript(card),
  );
  assert.ok(match, "the lineage webview is not showing");
  return match.value;
}

/** What a drawn lineage graph looks like as geometry: its table edges' crossings and the hops drawn over them. */
export interface DrawnCrossings {
  entry: string;
  /** Pairs of table edges whose drawn paths cross, counted from the paths in the DOM. */
  crossings: number;
  /** Hop arcs drawn in table edge paths, one per crossing the drawing marks. */
  hops: number;
  edges: number;
}

/**
 * The script that measures the drawn table edges. It parses each path's M, L and H/V commands into straight runs,
 * drops the hop arcs (an arc's ends join the run it interrupts), and counts each pair of edges whose runs cross at a
 * point inside both. Edges that share an end card never count, since they meet at its bubble.
 */
const DRAWN_CROSSINGS = `(() => {
  if (document.body.dataset.entry !== "lineage") return null;
  const edges = [...document.querySelectorAll(".react-flow__edge.lineage-table-edge")].map((edge) => {
    const d = edge.querySelector("path")?.getAttribute("d") ?? "";
    const id = edge.getAttribute("data-id") ?? "";
    const tokens = d.match(/[MLAHVCQZmlahvcqz]|-?\\d*\\.?\\d+(?:e-?\\d+)?/g) ?? [];
    const points = [];
    let hops = 0;
    for (let i = 0; i < tokens.length; ) {
      const command = tokens[i++];
      const take = (n) => tokens.slice(i, (i += n)).map(Number);
      if (command === "M" || command === "L") {
        const [x, y] = take(2);
        points.push([x, y]);
      } else if (command === "A") {
        const [, , , , , x, y] = take(7);
        hops += 1;
        points.push([x, y]);
      } else if (command === "Q") {
        const [, , x, y] = take(4);
        points.push([x, y]);
      }
    }
    const [from, to] = id.replace(/^t:/, "").split("->");
    return { from, to, hops, runs: points.slice(1).map((p, k) => [points[k], p]) };
  });
  const cross = ([[ax, ay], [bx, by]], [[cx, cy], [dx, dy]]) => {
    const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
    const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    return d1 * d2 < -1e-6 && d3 * d4 < -1e-6;
  };
  let crossings = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i], b = edges[j];
      if ([a.from, a.to].some((end) => end === b.from || end === b.to)) continue;
      if (a.runs.some((r) => b.runs.some((s) => cross(r, s)))) crossings += 1;
    }
  }
  return {
    entry: "lineage",
    crossings,
    hops: edges.reduce((sum, edge) => sum + edge.hops, 0),
    edges: edges.length,
  };
})()`;

/** Measures the drawn table edges of the lineage view. */
export async function readDrawnCrossings(): Promise<DrawnCrossings> {
  const match = await evaluatePanel<DrawnCrossings>(
    cdpPort(),
    PANELS.lineage.entry,
    DRAWN_CROSSINGS,
  );
  assert.ok(match, "the lineage webview is not showing");
  return match.value;
}

/** The text of the Layout readout of the lineage view, read from the drawn panel. */
const LAYOUT_READOUT = `(() => document.body.dataset.entry === "lineage" ? {
  entry: "lineage",
  text: document.querySelector("[data-testid=lineage-readout]")?.textContent ?? null,
} : null)()`;

/** Reads the text of the Layout readout of the lineage view: the measures of the last layout. */
export async function readLayoutReadout(): Promise<string> {
  const match = await evaluatePanel<{ entry: string; text: string | null }>(
    cdpPort(),
    PANELS.lineage.entry,
    LAYOUT_READOUT,
  );
  assert.ok(match, "the lineage webview is not showing");
  assert.ok(match.value.text, "the Layout readout is not drawn");
  return match.value.text;
}
