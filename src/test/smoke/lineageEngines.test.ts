import * as assert from "node:assert";
import * as vscode from "vscode";
import { currentFixtureName } from "./fixtureContext";
import { readDrawnCrossings } from "./lineageProbes";
import { evaluatePanel, waitForPanelGone } from "./panelFrames";
import { EXTENSION_ID, PANELS } from "./panels";
import { waitFor } from "./probeLog";
import { cdpPort, smokeHost } from "./smokeEnv";
import type { PanelEntry } from "./webviewInteractions";
import {
  clickInWebview,
  interactionEvidence,
  maximizePanelFor,
  restorePanelSize,
  showPanel,
} from "./webviewInteractions";

// On demand only: `just smoke-engines`. Draws several views with every layered engine and captures each, so the
// engines' drawings compare side by side.

const LINEAGE: PanelEntry = PANELS.lineage;
const ENGINES = ["classic", "balanced", "thorough"] as const;

/** The start models compared on each fixture, by path under `models/`. */
const VIEWS: Readonly<Record<string, readonly string[][]>> = {
  "lineage-layers": [
    ["21_intermediate", "int_orders__enriched.sql"],
    ["31_marts", "fct_orders.sql"],
    ["13_staging", "backend", "stg_backend__users.sql"],
  ],
  "lineage-groups": [["hub.sql"], ["fanout.sql"]],
};

/** What the view draws: its cards, table edges and loading state, and the start card's unopened expanders. */
interface View {
  entry: string;
  cards: number;
  tableEdges: number;
  busy: number;
  expanders: string[];
}

/** The view's state; `start` is the start model's name, whose card's collapsed sides the capture opens. */
const viewScript = (
  start: string,
) => `(() => document.body.dataset.entry === "lineage" ? {
  entry: "lineage",
  cards: document.querySelectorAll("[data-table]").length,
  tableEdges: document.querySelectorAll(".react-flow__edge.lineage-table-edge").length,
  busy: document.querySelectorAll('[aria-busy="true"]').length,
  expanders: [...document.querySelectorAll("[data-table$='.${start}'] button[aria-label]")]
    .filter((button) => !button.disabled)
    .map((button) => button.getAttribute("aria-label"))
    .filter((label) => /^Show \\d+ (more )?(parents|children)$/.test(label)),
} : null)()`;

async function readView(start: string): Promise<View> {
  const match = await evaluatePanel<View>(
    cdpPort(),
    LINEAGE.entry,
    viewScript(start),
  );
  assert.ok(match, "the lineage webview is not showing");
  return match.value;
}

/** Opens `model` in a fresh panel, so every engine starts from the same state. */
async function openFresh(model: readonly string[]): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.closePanel");
  await waitForPanelGone(cdpPort(), LINEAGE.entry);
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  assert.ok(root, "the fixture folder is open");
  await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument(
      vscode.Uri.joinPath(root, "models", ...model),
    ),
  );
  const api = await vscode.extensions.getExtension(EXTENSION_ID)!.activate();
  await api.ready;
  await showPanel(LINEAGE);
  await maximizePanelFor(LINEAGE.entry);
}

/**
 * Rounds of opening the start card's expanders; each round opens every side showing then, and a paged side
 * ("Show N more children") needs one round per page.
 */
const EXPAND_ROUNDS = 10;

/**
 * Waits until two idle reads agree, opening the start card's collapsed sides whenever they show (the card renders
 * before its expanders do), so the capture shows the settled, expanded drawing.
 */
async function settle(start: string): Promise<View> {
  const read = () => readView(start);
  for (let round = 0; round < EXPAND_ROUNDS; round++) {
    let previous = "";
    const view = await waitFor("the drawing should hold still", read, {
      until: (current) => {
        if (current.busy === 0 && current.expanders.length > 0) {
          return true;
        }
        const key = JSON.stringify([current.cards, current.tableEdges]);
        const stable =
          current.busy === 0 && current.tableEdges > 0 && key === previous;
        previous = key;
        return stable;
      },
      attempts: 40,
    });
    if (view.expanders.length === 0) {
      return view;
    }
    for (const label of view.expanders) {
      await clickInWebview(LINEAGE, { role: "button", name: label });
    }
  }
  throw new Error(
    `${start}'s expanders still show after ${EXPAND_ROUNDS} rounds`,
  );
}

const slug = (model: readonly string[]) =>
  (model.at(-1) ?? "view").replace(/\.sql$/, "");

suite("Lineage engines", function () {
  this.timeout(20 * 60_000);

  suiteTeardown(async function () {
    await vscode.workspace
      .getConfiguration("fusionPowerUser")
      .update(
        "lineage.engine",
        undefined,
        vscode.ConfigurationTarget.Workspace,
      );
    await restorePanelSize();
  });

  test("captures every view with every layered engine", async function () {
    const views = VIEWS[currentFixtureName() ?? ""];
    if (!views) {
      this.skip();
      return;
    }
    const evidence = interactionEvidence(smokeHost());
    const config = vscode.workspace.getConfiguration("fusionPowerUser");
    for (const model of views) {
      const drawn: Record<string, View> = {};
      for (const engine of ENGINES) {
        await config.update(
          "lineage.engine",
          engine,
          vscode.ConfigurationTarget.Workspace,
        );
        await openFresh(model);
        const view = await settle(slug(model));
        drawn[engine] = view;
        const geometry = await readDrawnCrossings();
        await evidence?.capture(LINEAGE, {
          name: `engines-${slug(model)}-${engine}`,
          expect:
            `${slug(model)} drawn by the ${engine} engine. Every engine draws the same cards and table edges; ` +
            "compare the crossings, hops and shape with the other engines' captures of this view.",
          measured: {
            view: slug(model),
            engine,
            ...geometry,
            cards: view.cards,
          },
        });
      }
      // The engines place the same graph, so they must agree on what is drawn.
      const counts = ENGINES.map((engine) => [
        drawn[engine].cards,
        drawn[engine].tableEdges,
      ]);
      assert.ok(
        counts.every(
          (count) => JSON.stringify(count) === JSON.stringify(counts[0]),
        ),
        `the engines drew different graphs for ${slug(model)}: ${JSON.stringify(counts)}`,
      );
    }
  });
});
