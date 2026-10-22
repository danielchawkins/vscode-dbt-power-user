import * as assert from "node:assert";
import * as vscode from "vscode";
import { HARNESS_SWITCHES } from "../../settings/environment";
import { evaluatePanel, validateSmokeHost } from "./cdpClient";
import { currentFixtureName } from "./fixtureContext";
import type { PanelEntry } from "./webviewInteractions";
import {
  clickInWebview,
  interactionEvidence,
  maximizePanelFor,
  restorePanelSize,
  showPanel,
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
    const header = [...card.querySelectorAll(":scope > div:first-child > span")];
    const box = card.getBoundingClientRect();
    return {
      id: card.dataset.table.split(".").at(-1),
      title: parts[0]?.textContent ?? "",
      file: parts.length === 3 ? parts[1].textContent : undefined,
      subtitle: header[3]?.textContent,
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
    process.env.FPU_CDP_PORT!,
    LINEAGE.entry,
    SNAPSHOT,
  );
  assert.ok(match, "the lineage webview is not showing");
  return match.value;
}

/** Polls the webview until `done` holds for its snapshot, and fails with the last snapshot otherwise. */
async function waitForSnapshot(
  what: string,
  done: (current: Snapshot) => boolean,
): Promise<Snapshot> {
  const deadline = Date.now() + 10_000;
  let last = await snapshot();
  while (!done(last)) {
    if (Date.now() >= deadline) {
      throw new Error(`${what}; the last snapshot was ${JSON.stringify(last)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    last = await snapshot();
  }
  return last;
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
    const drawn = await waitForSnapshot(
      "the start model's neighbourhood should draw all ten cards",
      (current) => current.cards.length === CARD_IDS.length,
    );
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
});
