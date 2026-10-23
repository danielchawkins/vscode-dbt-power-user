import * as assert from "node:assert";
import * as vscode from "vscode";
import { HARNESS_SWITCHES } from "../../settings/environment";
import { evaluatePanel, validateSmokeHost } from "./cdpClient";
import { currentFixtureName } from "./fixtureContext";
import { waitFor } from "./probeLog";
import type { PanelEntry } from "./webviewInteractions";
import {
  cdpPort,
  clickInWebview,
  interactionEvidence,
  maximizePanelFor,
  restorePanelSize,
  showPanel,
  zoomPastHalf,
} from "./webviewInteractions";

const EXTENSION_ID = "danielchawkins.fusion-power-user";
const LINEAGE: PanelEntry = {
  container: "workbench.view.extension.lineage_view",
  command: "fusionPowerUser.Lineage.focus",
  entry: "lineage",
};
/** The start model and its direct neighbours: sources and seeds, staging, marts, and the hidden audit_log card. */
const START = "int_orders__enriched";
const CARD_IDS = [
  "orders",
  "country_codes",
  "stg_shop__orders",
  "stg_backend__accounts",
  "stg_backend__users",
  "int_orders__enriched",
  "fct_orders",
  "dim_customers",
  "fct_finance__daily_revenue_by_region_and_channel",
  "audit_log",
];
const LAYER_BANDS = ["source", "staging", "intermediate", "marts", "other"];

const runsHere = () => currentFixtureName() === "lineage-layers";
const host = () =>
  validateSmokeHost(process.env[HARNESS_SWITCHES.smokeHost] ?? "");

/**
 * What the lineage webview draws now: the layer bands in draw order, every card with its title, file line and
 * subtitle, the chips, the edge counts, the expanders on the start card, and how many expanders are still loading.
 * Crossings and hops are not in the DOM.
 */
interface CardSnapshot {
  id: string;
  title: string;
  file?: string | undefined;
  subtitle?: string | undefined;
  top: number;
  left: number;
}

interface Snapshot {
  entry: string;
  bands: string[];
  cards: CardSnapshot[];
  chips: { label: string; text: string }[];
  edges: { total: number; table: number };
  busy: number;
  startExpanders: string[];
}

const SNAPSHOT = `(() => document.body.dataset.entry === "lineage" ? {
  entry: "lineage",
  bands: [...document.querySelectorAll(".react-flow__node-band [data-layer]")].map((el) => el.dataset.layer),
  cards: [...document.querySelectorAll("[data-table]")].map((card) => {
    const names = card.querySelector('span[title^="' + card.dataset.table + '"]');
    const parts = [...(names?.children ?? [])];
    const box = card.getBoundingClientRect();
    return {
      id: card.dataset.table.split(".").at(-1),
      title: parts[0]?.textContent ?? "",
      file: parts.length === 3 ? parts[1].textContent : undefined,
      subtitle: card.querySelector(":scope > div:first-child > [class*=subtitle]")?.textContent,
      top: Math.round(box.top),
      left: Math.round(box.left),
    };
  }),
  chips: [...document.querySelectorAll('button[aria-label^="Close "]')].map((button) => ({
    label: button.getAttribute("aria-label").slice("Close ".length),
    text: button.parentElement?.textContent ?? "",
  })),
  edges: {
    total: document.querySelectorAll(".react-flow__edge").length,
    table: document.querySelectorAll(".react-flow__edge.lineage-table-edge").length,
  },
  busy: document.querySelectorAll('[aria-busy="true"]').length,
  startExpanders: [...document.querySelectorAll('[data-table$=".int_orders__enriched"] button[aria-label]')]
    .map((button) => button.getAttribute("aria-label"))
    .filter((label) => /^Show \\d+ (more )?(parents|children)$/.test(label)),
} : null)()`;

async function snapshot(): Promise<Snapshot> {
  const match = await evaluatePanel<Snapshot>(
    cdpPort(),
    LINEAGE.entry,
    SNAPSHOT,
  );
  assert.ok(match, "the lineage webview is not showing");
  return match.value;
}

/** Polls the webview until `done` holds for its snapshot, and fails with the last snapshot otherwise. */
function waitForSnapshot(
  what: string,
  done: (current: Snapshot) => boolean,
): Promise<Snapshot> {
  return waitFor(what, snapshot, { until: done, attempts: 40 });
}

/** The start card's column list, the column edges traced from it, and the table edges' paths. */
interface ColumnState {
  entry: string;
  columnTables: string[];
  startColumns: number;
  traced: string[];
  tableD: string[];
}

const COLUMN_STATE = `(() => document.body.dataset.entry === "lineage" ? {
  entry: "lineage",
  columnTables: [...document.querySelectorAll("[data-table]")]
    .filter((n) => n.querySelector("[data-testid=lineage-columns]"))
    .map((n) => n.dataset.table.split(".").at(-1)),
  startColumns: document.querySelectorAll("[data-table$='.${START}'] [data-column]").length,
  traced: [...document.querySelectorAll(".react-flow__edge.lineage-column-edge")]
    .map((e) => e.getAttribute("data-id"))
    .sort(),
  tableD: [...document.querySelectorAll(".react-flow__edge.lineage-table-edge path")]
    .map((p) => p.getAttribute("d"))
    .sort(),
} : null)()`;

/** Clicks the button labelled `label` (text or aria-label) on the start card. */
const clickOnStart = (label: string) => `(() => {
  if (document.body.dataset.entry !== "lineage") return null;
  const node = document.querySelector("[data-table$='.${START}']");
  const want = ${JSON.stringify(label)};
  const button = [...(node?.querySelectorAll("button") ?? [])].find(
    (b) => b.textContent.trim() === want || b.getAttribute("aria-label") === want,
  );
  button?.click();
  return { entry: "lineage", clicked: Boolean(button) };
})()`;

/** Clicks the first column row of the start card. */
const CLICK_START_COLUMN = `(() => {
  if (document.body.dataset.entry !== "lineage") return null;
  const column = document.querySelector("[data-table$='.${START}'] [data-column]");
  column?.click();
  return { entry: "lineage", clicked: Boolean(column) };
})()`;

async function readColumns(): Promise<ColumnState> {
  const match = await evaluatePanel<ColumnState>(
    cdpPort(),
    LINEAGE.entry,
    COLUMN_STATE,
  );
  assert.ok(match, "the lineage webview is not showing");
  return match.value;
}

/** Polls the column state until `done` holds, and fails with the last state otherwise. */
function waitForColumns(
  what: string,
  done: (current: ColumnState) => boolean,
): Promise<ColumnState> {
  return waitFor(what, readColumns, { until: done, attempts: 40 });
}

/**
 * Polls the column state until the traced edges and table edge paths hold still: two consecutive reads agree, and
 * at least one column edge is drawn. Edges can arrive in parts, so the first non-empty read is not a baseline.
 */
function waitForStableColumns(what: string): Promise<ColumnState> {
  let previous: string | undefined;
  return waitFor(what, readColumns, {
    until: (current) => {
      const key = JSON.stringify([current.traced, current.tableD]);
      const stable = current.traced.length > 0 && key === previous;
      previous = key;
      return stable;
    },
    attempts: 40,
  });
}

/**
 * Opens the start card's column list, clicking "Columns" only while the list is closed, then clicks its first column.
 * Returns the column state once the click has traced an edge.
 */
async function traceStartColumn(): Promise<ColumnState> {
  const deadline = Date.now() + 10_000;
  let state = await readColumns();
  while (!state.columnTables.includes(START)) {
    if (Date.now() >= deadline) {
      throw new Error(
        `the start card's column list did not open; the last state was ${JSON.stringify(state)}`,
      );
    }
    await evaluatePanel(cdpPort(), LINEAGE.entry, clickOnStart("Columns"));
    await new Promise((resolve) => setTimeout(resolve, 500));
    state = await readColumns();
  }
  await waitForColumns(
    "the start card should list its columns",
    (current) => current.startColumns > 0,
  );
  const clicked = await evaluatePanel<{ entry: string; clicked: boolean }>(
    cdpPort(),
    LINEAGE.entry,
    CLICK_START_COLUMN,
  );
  assert.ok(clicked?.value.clicked, "the start card has a column row to click");
  return waitForStableColumns(
    "clicking a start column should trace column edges",
  );
}

/**
 * Waits for the start card's auto-expansion to settle, clicks any expander it still offers, and returns the snapshot
 * once all ten cards are drawn.
 */
async function settleStart(): Promise<Snapshot> {
  // Wait for the start card's auto-expansion to settle: no expander is still loading. Then the view is at rest, and
  // a side left collapsed shows a button on the start card that expands it.
  const settled = await waitForSnapshot(
    "the start card should settle, then draw its neighbours or offer to expand them",
    (current) =>
      current.busy === 0 &&
      (current.cards.length === CARD_IDS.length ||
        current.startExpanders.length > 0),
  );
  for (const label of settled.startExpanders) {
    await clickInWebview(LINEAGE, { role: "button", name: label });
  }
  // A click that lands while the graph redraws is lost, so an expander still offered once the view is idle is
  // clicked again.
  return waitFor(
    "the start model's neighbourhood should draw all ten cards",
    async () => {
      const current = await snapshot();
      if (
        current.cards.length < CARD_IDS.length &&
        current.busy === 0 &&
        current.startExpanders.length > 0
      ) {
        for (const label of current.startExpanders) {
          await clickInWebview(LINEAGE, { role: "button", name: label });
        }
      }
      return current;
    },
    {
      until: (current) => current.cards.length === CARD_IDS.length,
      attempts: 40,
    },
  );
}

/** Opens the model, so the lineage view starts from it, and shows the tall lineage panel. */
async function openModel(relativePath: string[]): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  assert.ok(root, "the fixture folder is open");
  await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument(
      vscode.Uri.joinPath(root, ...relativePath),
    ),
  );
  const api = await vscode.extensions.getExtension(EXTENSION_ID)!.activate();
  await api.ready;
  await showPanel(LINEAGE);
  await maximizePanelFor(LINEAGE.entry);
}

suite("Lineage layers", function () {
  this.timeout(300_000);

  // The suite's teardown runs when this suite ends, so later suites start with the default bottom panel.
  suiteTeardown(async function () {
    await restorePanelSize();
  });

  test("draws the start model's neighbours in layer bands, with Other beside them", async function () {
    if (!runsHere()) {
      this.skip();
      return;
    }
    const evidence = interactionEvidence(host());

    await openModel(["models", "21_intermediate", `${START}.sql`]);
    const drawn = await settleStart();
    assert.deepStrictEqual(
      drawn.cards.map((card) => card.id).toSorted(),
      CARD_IDS.toSorted(),
    );
    assert.deepStrictEqual([...new Set(drawn.bands)], LAYER_BANDS);
    const byId = new Map(drawn.cards.map((card) => [card.id, card]));
    // The source and the seed share the source row.
    assert.strictEqual(byId.get("orders")?.top, byId.get("country_codes")?.top);
    // Only the start card shows its subtitle line; the file line is on every card.
    assert.ok(
      byId.get(START)?.subtitle,
      "the start card should show its relation line",
    );
    // The hidden audit_log card is drawn, but its edge is not.
    assert.strictEqual(
      drawn.edges.table,
      11,
      `table edges: ${JSON.stringify(drawn.edges)}`,
    );
    assert.deepStrictEqual(drawn.chips, []);

    await evidence?.capture(LINEAGE, {
      name: "lineage-layers-layered",
      expect:
        "The start model's neighbourhood in layered mode: bands labelled source, staging, intermediate and marts " +
        "from top to bottom, the untagged audit_log card beside them in the other band, every card titled with its " +
        "alias, the start card showing its relation line, and no group chips. Crossings and hops are not drawn as " +
        "text and are not in this checkpoint.",
      measured: {
        bands: drawn.bands,
        cards: drawn.cards,
        chips: drawn.chips,
        edges: drawn.edges,
        startExpanders: drawn.startExpanders,
      },
    });
  });

  test("traces a start column's edges, drops them zoomed out, and redraws them zoomed in", async function () {
    if (!runsHere()) {
      this.skip();
      return;
    }
    const evidence = interactionEvidence(host());

    await openModel(["models", "21_intermediate", `${START}.sql`]);
    await settleStart();
    const traced = await traceStartColumn();
    assert.ok(
      traced.traced.length > 0,
      `the start column traced ${traced.traced.length} edges`,
    );
    const tracedBefore = traced.traced.length;
    const tableDBefore = traced.tableD;

    await evidence?.capture(LINEAGE, {
      name: "lineage-layers-trace",
      expect:
        "The start card with its Columns list open and its first column clicked: column edges are drawn from that " +
        "column to the cards it traces to, alongside the table edges. The traced edge ids and table edge paths are " +
        "in measured.",
      measured: {
        traced: traced.traced,
        tableD: traced.tableD,
      },
    });

    await zoomPastHalf(LINEAGE, "out");
    const zoomedOut = await waitForColumns(
      "zooming out should drop the column edges",
      (current) => current.traced.length === 0,
    );
    assert.deepStrictEqual(zoomedOut.tableD, tableDBefore);

    await evidence?.capture(LINEAGE, {
      name: "lineage-layers-trace-zoomed-out",
      expect:
        "The same graph zoomed out below 50%: no column edges are drawn, and the table edges are in the same places " +
        "as before the zoom.",
      measured: {
        traced: zoomedOut.traced,
        tableD: zoomedOut.tableD,
      },
    });

    await zoomPastHalf(LINEAGE, "in");
    const zoomedIn = await waitForColumns(
      "zooming back in should draw the column edges again",
      (current) => current.traced.length === tracedBefore,
    );

    await evidence?.capture(LINEAGE, {
      name: "lineage-layers-trace-zoomed-in",
      expect:
        "Zoomed back to 50% or more: the column edges are drawn again, the same number as before the zoom out.",
      measured: {
        traced: zoomedIn.traced,
        tableD: zoomedIn.tableD,
      },
    });
  });
});
