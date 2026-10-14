import * as vscode from "vscode";
import { HARNESS_SWITCHES } from "../../settings/environment";
import { evaluatePanel, validateSmokeHost } from "./cdpClient";
import { currentFixtureName } from "./fixtureContext";
import type { PanelEntry } from "./webviewInteractions";
import {
  clickInWebview,
  clickWebviewPoint,
  expectWebviewDom,
  hoverWebviewPoint,
  interactionEvidence,
  showPanel,
} from "./webviewInteractions";

const EXTENSION_ID = "danielchawkins.fusion-power-user";
const RENDER_TEST_RESULT = "fusionPowerUser.test.renderQueryResult";
const RESULTS: PanelEntry = {
  container: "workbench.view.extension.dbt_preview_results",
  command: "fusionPowerUser.PreviewResults.focus",
  entry: "queryResults",
};
/** The Preview tab's label carries the row count and elapsed time, so it has no stable name to search for. */
const PREVIEW_TAB = "ul.nav > li:first-child > button";
/**
 * The Open in Tab and Clear results buttons drop their labels until the pointer is over them, so they are found by
 * icon and hovered first.
 */
const OPEN_IN_TAB_ICON = "button:has(.codicon-link-external)";
const CLEAR_RESULTS_ICON = "button:has(.codicon-close)";
/** The title Open in Tab gives the editor tab it opens: the webview's name and a timestamp. */
const RESULTS_TAB_PREFIX = "Query results_";

/** Records the MIME type of each blob the results frame turns into a URL, so the CSV export can be seen. */
const WATCH_BLOBS = `(() => {
  if (document.body.dataset.entry !== "queryResults") return null;
  window.createdBlobTypes = [];
  const createObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    window.createdBlobTypes.push(blob.type);
    return createObjectURL(blob);
  };
  return { entry: "queryResults" };
})()`;

const READ_BLOB_TYPES = `(() => document.body.dataset.entry === "queryResults"
  ? { entry: "queryResults", types: window.createdBlobTypes ?? [] }
  : null)()`;

/** The SQL tab's CodeBlock renders the compiled SQL inside `pre code.language-sql`. */
const READ_COMPILED_SQL = `(() => document.body.dataset.entry === "queryResults"
  ? { entry: "queryResults", text: document.querySelector("pre code.language-sql")?.textContent ?? "" }
  : null)()`;

const runsHere = () => currentFixtureName() === "single-project";
const host = () =>
  validateSmokeHost(process.env[HARNESS_SWITCHES.smokeHost] ?? "");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until `done` holds; the effect of a click reaches the host or the editor asynchronously. */
async function waitUntil(
  what: string,
  done: () => boolean | Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  do {
    if (await done()) {
      return;
    }
    await sleep(250);
  } while (Date.now() < deadline);
  throw new Error(`timed out waiting for ${what}`);
}

async function createdBlobTypes(): Promise<string[]> {
  const match = await evaluatePanel<{ entry: string; types: string[] }>(
    process.env.FPU_CDP_PORT!,
    RESULTS.entry,
    READ_BLOB_TYPES,
  );
  return match?.value.types ?? [];
}

const resultTabs = () =>
  vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.label.startsWith(RESULTS_TAB_PREFIX));

/** The `compiled_sql` of the result that RENDER_TEST_RESULT renders, see queryResultTestCommand.ts. */
const SYNTHETIC_COMPILED_SQL = "select synthetic /* compiled */";

async function compiledSqlText(): Promise<string> {
  const match = await evaluatePanel<{ entry: string; text: string }>(
    process.env.FPU_CDP_PORT!,
    RESULTS.entry,
    READ_COMPILED_SQL,
  );
  return match?.value.text ?? "";
}

suite("Query results interactions", function () {
  this.timeout(300_000);

  test("clicks the result tabs and toolbar controls except Limit run, and checks each effect", async function () {
    if (!runsHere()) {
      this.skip();
      return;
    }
    const evidence = interactionEvidence(host());

    const api = await vscode.extensions.getExtension(EXTENSION_ID)!.activate();
    await api.ready;
    await showPanel(RESULTS);
    await vscode.commands.executeCommand(RENDER_TEST_RESULT, 3);
    await expectWebviewDom(RESULTS, { role: "grid" });

    await clickInWebview(RESULTS, { role: "button", name: "History" });
    await expectWebviewDom(RESULTS, { absent: "[role=grid]" });
    await evidence?.capture(RESULTS, {
      name: "query-results-history-open",
      expect: "History tab selected; no result grid is shown.",
      measured: { tab: "History" },
    });

    await clickWebviewPoint(RESULTS, { selector: PREVIEW_TAB });
    await expectWebviewDom(RESULTS, { role: "grid" });

    await clickInWebview(RESULTS, { role: "button", name: "SQL" });
    await expectWebviewDom(RESULTS, { absent: "[role=grid]" });
    await waitUntil("the compiled SQL view", async () =>
      (await compiledSqlText()).includes(SYNTHETIC_COMPILED_SQL),
    );
    await clickWebviewPoint(RESULTS, { selector: PREVIEW_TAB });
    await expectWebviewDom(RESULTS, { role: "grid" });

    await evaluatePanel(process.env.FPU_CDP_PORT!, RESULTS.entry, WATCH_BLOBS);
    await clickInWebview(RESULTS, { role: "button", name: "Export CSV" });
    await waitUntil("the CSV blob", async () =>
      (await createdBlobTypes()).includes("text/csv"),
    );

    // Open in Tab opens an editor tab named "Query results_<timestamp>"; the tab is closed again once seen.
    const tabsBefore = new Set(resultTabs().map((tab) => tab.label));
    await hoverWebviewPoint(RESULTS, OPEN_IN_TAB_ICON);
    await clickInWebview(RESULTS, { role: "button", name: "Open in Tab" });
    await waitUntil("the Query results editor tab", () =>
      resultTabs().some((tab) => !tabsBefore.has(tab.label)),
    );
    await vscode.window.tabGroups.close(
      resultTabs().filter((tab) => !tabsBefore.has(tab.label)),
    );
    await showPanel(RESULTS);

    // Clearing the results hides the buttons that need them, so it follows Open in Tab.
    await hoverWebviewPoint(RESULTS, CLEAR_RESULTS_ICON);
    await clickInWebview(RESULTS, { role: "button", name: "Clear results" });
    await expectWebviewDom(RESULTS, { absent: "[role=grid]" });

    await clickWebviewPoint(RESULTS, { selector: "#query-limit" });
    await expectWebviewDom(RESULTS, {
      role: "spinbutton",
      name: "Limit",
      focused: true,
    });

    // +Q runs runAdhocQuery on the host, which opens a new untitled jinja-sql document.
    const documentsBefore = new Set(
      vscode.workspace.textDocuments.map((doc) => doc.uri.toString()),
    );
    await clickInWebview(RESULTS, { role: "button", name: "open-adhoc-query" });
    await waitUntil("a new untitled SQL editor", () => {
      const doc = vscode.window.activeTextEditor?.document;
      return (
        doc !== undefined &&
        doc.isUntitled &&
        doc.languageId === "jinja-sql" &&
        !documentsBefore.has(doc.uri.toString())
      );
    });
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  });
});
