import * as assert from "node:assert";
import { evaluatePanel } from "./cdpClient";
import { PANELS } from "./panels";
import { cdpPort } from "./webviewInteractions";

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
