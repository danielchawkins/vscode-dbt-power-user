import * as assert from "node:assert";
import * as vscode from "vscode";
import { HARNESS_SWITCHES } from "../../settings/environment";
import { pollUntil } from "../async";
import { evaluatePanel, validateSmokeHost } from "./cdpClient";
import { currentFixtureName } from "./fixtureContext";
import {
  CARD_IDS,
  DRAWN_TABLE_EDGES,
  LAYER_BANDS,
  START,
} from "./lineageLayersExpected";
import type { ColumnState } from "./lineageProbes";
import {
  clickFirstColumn,
  clickOnCard,
  readColumns,
  tracedCardsListed,
} from "./lineageProbes";
import { EXTENSION_ID, PANELS } from "./panels";
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

const LINEAGE: PanelEntry = PANELS.lineage;

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
  startExpanders: [...document.querySelectorAll('[data-table$=".int_orders__enriched"] button[aria-label]:not(:disabled)')]
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

const readStart = () => readColumns(START);

/** Polls the column state until `done` holds, and fails with the last state otherwise. */
function waitForColumns(
  what: string,
  done: (current: ColumnState) => boolean,
): Promise<ColumnState> {
  return waitFor(what, readStart, { until: done, attempts: 40 });
}

/**
 * Polls the column state until the traced edges and table edge paths hold still: at least one column edge is drawn,
 * every traced card lists its columns, and two consecutive reads agree.
 */
function waitForStableColumns(what: string): Promise<ColumnState> {
  let previous: string | undefined;
  return waitFor(what, readStart, {
    until: (current) => {
      const key = JSON.stringify([current.traced, current.tableD]);
      const stable =
        current.traced.length > 0 &&
        tracedCardsListed(current) &&
        key === previous;
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
  await pollUntil(
    async () => {
      const current = await readStart();
      if (!current.columnTables.includes(START)) {
        await evaluatePanel(
          cdpPort(),
          LINEAGE.entry,
          clickOnCard(START, "Columns"),
        );
      }
      return current;
    },
    (current) => current.columnTables.includes(START),
    {
      timeoutMs: 10_000,
      intervalMs: 500,
      describe: (last) =>
        `the start card's column list to open; the last state was ${JSON.stringify(last)}`,
    },
  );
  await waitForColumns(
    "the start card should list its columns",
    (current) => current.cardColumns > 0,
  );
  const clicked = await evaluatePanel<{ entry: string; clicked: boolean }>(
    cdpPort(),
    LINEAGE.entry,
    clickFirstColumn(START),
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
      DRAWN_TABLE_EDGES,
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
