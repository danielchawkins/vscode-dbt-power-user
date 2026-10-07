import * as assert from "assert";
import * as vscode from "vscode";
import { HARNESS_SWITCHES } from "../../settings/environment";
import {
  evaluatePanel,
  readWebviewHeap,
  validateSmokeHost,
  waitForWebviewPaint,
} from "./cdpClient";
import { currentFixtureName } from "./fixtureContext";

const EXTENSION_ID = "danielchawkins.fusion-power-user";
const RENDER_TEST_RESULT = "fusionPowerUser.test.renderQueryResult";
const RESULTS = {
  container: "workbench.view.extension.dbt_preview_results",
  command: "fusionPowerUser.PreviewResults.focus",
  entry: "queryResults",
};
const DOCS = {
  container: "workbench.view.extension.docs_edit_view",
  command: "fusionPowerUser.DocsEdit.focus",
  entry: "documentationEditor",
};
const OTHER_PANEL = "workbench.view.extension.lineage_view";
const LINEAGE = {
  container: OTHER_PANEL,
  command: "fusionPowerUser.Lineage.focus",
  entry: "lineage",
};

/** The drawn tables, the tables with an open column list, the traced column edges and the page's load time. */
const READ_LINEAGE = `(() => {
  if (document.body.dataset.entry !== "lineage") return null;
  const tables = [...document.querySelectorAll("[data-table]")];
  return {
    entry: "lineage",
    tables: tables.map((n) => n.dataset.table).sort(),
    columnTables: tables
      .filter((n) => n.querySelector("[data-testid=lineage-columns]"))
      .map((n) => n.dataset.table)
      .sort(),
    columns: [...document.querySelectorAll("[data-column]")].map((c) => c.dataset.column),
    traced: [...document.querySelectorAll(".react-flow__edge.lineage-column-edge")]
      .map((e) => e.getAttribute("data-id"))
      .sort(),
    timeOrigin: performance.timeOrigin,
  };
})()`;

/** Clicks the button labelled `label` (text or aria-label) on the `child` table node. */
const clickOnChild = (label: string) => `(() => {
  if (document.body.dataset.entry !== "lineage") return null;
  const node = document.querySelector("[data-table$='.child']");
  const want = ${JSON.stringify(label)};
  const button = [...(node?.querySelectorAll("button") ?? [])].find(
    (b) => b.textContent.trim() === want || b.getAttribute("aria-label") === want,
  );
  button?.click();
  return { entry: "lineage", clicked: Boolean(button) };
})()`;

/** Clicks the first column row of the `child` table node. */
const CLICK_FIRST_COLUMN = `(() => {
  if (document.body.dataset.entry !== "lineage") return null;
  const column = document.querySelector("[data-table$='.child'] [data-column]");
  column?.click();
  return { entry: "lineage", clicked: Boolean(column) };
})()`;

/** The model description, whether the editor marks it modified and offers Save, and the page's load time. */
const READ_DOCS = `(() => {
  if (document.body.dataset.entry !== "documentationEditor") return null;
  const input = document.querySelector("textarea");
  return {
    entry: "documentationEditor",
    description: input?.value ?? null,
    modified: document.body.innerText.includes("modified"),
    save: [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Save"),
    timeOrigin: performance.timeOrigin,
  };
})()`;

/** Types `text` into the model description the way React sees a keystroke. */
const typeDescription = (text: string) => `(() => {
  if (document.body.dataset.entry !== "documentationEditor") return null;
  const input = document.querySelector("textarea");
  if (!input) return { entry: "documentationEditor", typed: false };
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(input, ${JSON.stringify(text)});
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return { entry: "documentationEditor", typed: true };
})()`;

/**
 * The row count the grid reports (`aria-rowcount` less the header row), the `label` cell of its first painted row,
 * and whether that row is painted; the grid paints only the rows in its viewport.
 */
const READ_GRID = `(() => {
  if (document.body.dataset.entry !== "queryResults") return null;
  const grid = document.querySelector("[role=grid]");
  if (!grid) return { entry: "queryResults", rows: 0, first: null, painted: false };
  const headers = [...grid.querySelectorAll("[role=columnheader]")].map((h) => h.textContent.trim());
  const index = headers.findIndex((h) => h.startsWith("label"));
  const row = grid.querySelector("[role=row][aria-rowindex]");
  const first = index < 0 || !row ? null : row.querySelectorAll("[role=gridcell]")[index]?.textContent.trim() ?? null;
  return {
    entry: "queryResults",
    rows: Number(grid.getAttribute("aria-rowcount") ?? 1) - 1,
    first,
    painted: first !== null,
  };
})()`;

interface Grid {
  entry: string;
  rows: number;
  first: string | null;
  painted: boolean;
}

interface Docs {
  entry: string;
  description: string | null;
  modified: boolean;
  save: boolean;
  timeOrigin: number;
}

/** The active title tab, the row count it reports and the page's load time, which changes when VS Code rebuilds it. */
const READ_TABS = `(() => {
  if (document.body.dataset.entry !== "queryResults") return null;
  const tabs = [...document.querySelectorAll(".nav-link")];
  return {
    entry: "queryResults",
    active: tabs.find((tab) => tab.classList.contains("active"))?.textContent?.trim() ?? "",
    tabs: tabs.map((tab) => tab.textContent.trim()),
    timeOrigin: performance.timeOrigin,
  };
})()`;

const clickTab = (label: string) => `(() => {
  if (document.body.dataset.entry !== "queryResults") return null;
  const tab = [...document.querySelectorAll(".nav-link")].find((t) => t.textContent.trim().startsWith(${JSON.stringify(label)}));
  tab?.click();
  return { entry: "queryResults", clicked: Boolean(tab) };
})()`;

interface Tabs {
  entry: string;
  active: string;
  tabs: string[];
  timeOrigin: number;
}

interface LineageState {
  entry: string;
  tables: string[];
  columnTables: string[];
  columns: string[];
  traced: string[];
  timeOrigin: number;
}

suite("Panel view state", function () {
  this.timeout(300_000);

  test("restores the query results tab after the panel is hidden and shown", async function () {
    if (currentFixtureName() !== "single-project") {
      this.skip();
      return;
    }
    const port = process.env.FPU_CDP_PORT;
    assert.ok(port, "smoke requires CDP port");
    const host = validateSmokeHost(
      process.env[HARNESS_SWITCHES.smokeHost] ?? "",
    );
    const api = await vscode.extensions.getExtension(EXTENSION_ID)!.activate();
    await api.ready;

    await showResults(port, host);
    await vscode.commands.executeCommand(RENDER_TEST_RESULT, 3);
    const before = await waitForTabs(port, (tabs) =>
      tabs.tabs.some((tab) => tab.startsWith("SQL")),
    );
    await evaluatePanel(port, RESULTS.entry, clickTab("SQL"));
    const selected = await waitForTabs(port, (tabs) => tabs.active === "SQL");

    await vscode.commands.executeCommand(OTHER_PANEL);
    await sleep(1_000);
    await showResults(port, host);
    // The rebuilt page paints the default tab before the saved one is restored.
    const after = await waitForTabs(
      port,
      (tabs) =>
        tabs.timeOrigin !== selected.timeOrigin &&
        tabs.active === "SQL" &&
        tabs.tabs.some((tab) => tab.startsWith("Preview")),
    );
    console.log(
      `FPU_SMOKE_VIEW_STATE=${JSON.stringify({ host, before, selected, after })}`,
    );
    assert.notStrictEqual(
      after.timeOrigin,
      selected.timeOrigin,
      "hiding the panel should rebuild its page without retainContextWhenHidden",
    );
    assert.strictEqual(
      after.active,
      "SQL",
      "the active tab should be restored",
    );
    assert.ok(
      after.tabs.some((tab) => tab.startsWith("Preview 3 rows")),
      `the host should replay the last result: ${JSON.stringify(after.tabs)}`,
    );
    await evaluatePanel(port, RESULTS.entry, clickTab("Preview"));
    await waitForTabs(port, (tabs) => tabs.active.startsWith("Preview"));
  });

  test("keeps an unsaved documentation edit after the editor is hidden and shown", async function () {
    if (currentFixtureName() !== "single-project") {
      this.skip();
      return;
    }
    const port = process.env.FPU_CDP_PORT!;
    const host = validateSmokeHost(
      process.env[HARNESS_SWITCHES.smokeHost] ?? "",
    );
    const folder = vscode.workspace.workspaceFolders![0];
    await vscode.window.showTextDocument(
      vscode.Uri.joinPath(folder.uri, "models/child.sql"),
    );
    await showPanel(port, host, DOCS);
    const loaded = await waitForDocs(port, (docs) => docs.description !== null);
    const edit = `${loaded.description} smoke draft`;
    await evaluatePanel(port, DOCS.entry, typeDescription(edit));
    const edited = await waitForDocs(
      port,
      (docs) => docs.description === edit && docs.modified,
    );

    await showPanel(port, host, RESULTS);
    await sleep(1_000);
    await showPanel(port, host, DOCS);
    const after = await waitForDocs(
      port,
      (docs) =>
        docs.timeOrigin !== edited.timeOrigin && docs.description === edit,
    );

    console.log(
      `FPU_SMOKE_DOCS_DRAFT=${JSON.stringify({ host, loaded, edited, after })}`,
    );
    assert.strictEqual(after.description, edit, "the draft should survive");
    assert.ok(after.modified && after.save, "the editor should still be dirty");

    await evaluatePanel(port, DOCS.entry, typeDescription(loaded.description!));
    await waitForDocs(port, (docs) => !docs.modified);
  });

  test("restores the lineage graph after the panel is hidden and shown", async function () {
    if (currentFixtureName() !== "single-project") {
      this.skip();
      return;
    }
    const port = process.env.FPU_CDP_PORT!;
    const host = validateSmokeHost(
      process.env[HARNESS_SWITCHES.smokeHost] ?? "",
    );
    const folder = vscode.workspace.workspaceFolders![0];
    await vscode.window.showTextDocument(
      vscode.Uri.joinPath(folder.uri, "models/child.sql"),
    );
    await showPanel(port, host, LINEAGE);
    const drawn = await waitForLineage(port, (g) => g.tables.length === 2);
    await evaluatePanel(port, LINEAGE.entry, clickOnChild("Hide 1 parents"));
    await waitForLineage(port, (g) => g.tables.length === 1);
    await evaluatePanel(port, LINEAGE.entry, clickOnChild("Show 1 parents"));
    await waitForLineage(port, (g) => g.tables.length === 2);
    // An earlier suite may leave the column list open, and the view state restores it after the graph is drawn.
    // "Columns" toggles, so click only on a closed list, then read again: a restore landing after a blind click
    // would close the list it had just opened.
    let before = (await waitFor(
      async () => {
        const state = await readLineage(port);
        if (state?.columnTables.length === 0) {
          await evaluatePanel(port, LINEAGE.entry, clickOnChild("Columns"));
          await sleep(500);
          return readLineage(port);
        }
        return state;
      },
      (g): g is LineageState => g !== undefined && g.columnTables.length === 1,
      "the lineage column list never opened",
    )) as LineageState;
    if (before.columns.length > 0 && before.traced.length === 0) {
      await evaluatePanel(port, LINEAGE.entry, CLICK_FIRST_COLUMN);
      before = await waitForLineage(port, (g) => g.traced.length > 0);
    }

    await showPanel(port, host, RESULTS);
    await sleep(1_000);
    await showPanel(port, host, LINEAGE);
    const after = await waitForLineage(
      port,
      (g) =>
        g.timeOrigin !== before.timeOrigin &&
        g.columnTables.length === before.columnTables.length &&
        g.traced.length === before.traced.length,
    );
    console.log(
      `FPU_SMOKE_LINEAGE_STATE=${JSON.stringify({ host, drawn, before, after })}`,
    );
    assert.notStrictEqual(
      after.timeOrigin,
      before.timeOrigin,
      "hiding the panel should rebuild its page without retainContextWhenHidden",
    );
    assert.deepStrictEqual(after.tables, before.tables, "same tables drawn");
    assert.deepStrictEqual(
      after.columnTables,
      before.columnTables,
      "same column lists open",
    );
    assert.deepStrictEqual(after.traced, before.traced, "same traced edges");

    await evaluatePanel(port, LINEAGE.entry, clickOnChild("Columns"));
    await waitForLineage(port, (g) => g.columnTables.length === 0);
  });

  test("records webview heap across hide/show cycles with a large result", async function () {
    const rows = Number(process.env.FPU_MEMORY_ROWS ?? "0");
    if (currentFixtureName() !== "single-project" || rows <= 0) {
      this.skip();
      return;
    }
    const port = process.env.FPU_CDP_PORT!;
    const host = validateSmokeHost(
      process.env[HARNESS_SWITCHES.smokeHost] ?? "",
    );
    await showResults(port, host);
    await vscode.commands.executeCommand(RENDER_TEST_RESULT, rows);
    const samples = [await sampleHeaps(port, rows)];
    for (let cycle = 0; cycle < 10; cycle += 1) {
      await vscode.commands.executeCommand(OTHER_PANEL);
      await sleep(1_000);
      await showResults(port, host);
      samples.push(await sampleHeaps(port, rows));
    }
    const growth = (key: "frame" | "host") =>
      (samples[samples.length - 1][key] - samples[0][key]) / samples[0][key];
    console.log(
      `FPU_WEBVIEW_HEAP=${JSON.stringify({
        host,
        rows,
        growth: {
          frame: growth("frame"),
          host: growth("host"),
        },
        samples,
      })}`,
    );
  });
});

async function readLineage(port: string): Promise<LineageState | undefined> {
  return (await evaluatePanel<LineageState>(port, LINEAGE.entry, READ_LINEAGE))
    ?.value;
}

async function waitForLineage(
  port: string,
  done: (graph: LineageState) => boolean,
): Promise<LineageState> {
  return waitFor(
    async () =>
      (await evaluatePanel<LineageState>(port, LINEAGE.entry, READ_LINEAGE))
        ?.value,
    (graph): graph is LineageState => graph !== undefined && done(graph),
    "the lineage graph never matched",
  ) as Promise<LineageState>;
}

async function showResults(port: string, host: string): Promise<void> {
  await showPanel(port, host, RESULTS);
}

async function showPanel(
  port: string,
  host: string,
  panel: { container: string; command: string; entry: string },
): Promise<void> {
  await vscode.commands.executeCommand(panel.container);
  await vscode.commands.executeCommand(panel.command);
  await waitForWebviewPaint(port, host, panel.entry);
}

/**
 * Once the grid has painted rows of the `rows`-row result, the used heap of the query results frame and of this
 * extension host.
 */
async function sampleHeaps(port: string, rows: number) {
  await waitForTabs(port, (tabs) =>
    tabs.tabs.some((tab) => tab.startsWith(`Preview ${rows} rows`)),
  );
  const grid = await waitFor(
    async () =>
      (await evaluatePanel<Grid>(port, RESULTS.entry, READ_GRID))?.value,
    (value) =>
      value !== undefined &&
      value.rows === rows &&
      value.first === "row 0" &&
      value.painted,
    `The grid never reported ${rows} rows and painted the first`,
  );
  await sleep(2_000);
  return {
    tableRows: grid!.rows,
    frame: (await readWebviewHeap(port, RESULTS.entry)).usedSize,
    host: process.memoryUsage().heapUsed,
  };
}

async function waitForDocs(
  port: string,
  done: (docs: Docs) => boolean,
): Promise<Docs> {
  return waitFor(
    async () => (await evaluatePanel<Docs>(port, DOCS.entry, READ_DOCS))?.value,
    (docs): docs is Docs => docs !== undefined && done(docs),
    "the documentation editor never matched",
  ) as Promise<Docs>;
}

async function waitFor<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  message: string,
): Promise<T> {
  let last: T | undefined;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    last = await read();
    if (done(last)) {
      return last;
    }
    await sleep(250);
  }
  throw new Error(`${message}: ${JSON.stringify(last)}`);
}

async function waitForTabs(
  port: string,
  done: (tabs: Tabs) => boolean,
): Promise<Tabs> {
  let last: Tabs | undefined;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    last = (await evaluatePanel<Tabs>(port, RESULTS.entry, READ_TABS))?.value;
    if (last && done(last)) {
      return last;
    }
    await sleep(250);
  }
  throw new Error(`query results tabs never matched: ${JSON.stringify(last)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
