import * as assert from "assert";
import * as vscode from "vscode";
import { HARNESS_SWITCHES } from "../../settings/environment";
import {
  evaluatePanel,
  readWebviewHeap,
  readWorkerHeaps,
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
 * The row count of the table Perspective loaded, its first `label`, and whether the datagrid's painted text, read
 * through its shadow roots, contains that label; the grid paints only the rows in its viewport.
 */
const READ_GRID = `(async () => {
  if (document.body.dataset.entry !== "queryResults") return null;
  const viewer = document.querySelector("perspective-viewer");
  if (!viewer) return { entry: "queryResults", rows: 0, first: null, painted: false };
  const table = await viewer.getTable(true);
  const view = await table.view();
  const rows = await view.num_rows();
  const columns = await view.to_columns({ start_row: 0, end_row: 1 });
  await view.delete();
  const first = columns.label?.[0] ?? null;
  let text = "";
  const walk = (n) => {
    if (n.nodeName === "TBODY") text += n.textContent;
    if (n.shadowRoot) walk(n.shadowRoot);
    n.childNodes.forEach(walk);
  };
  walk(viewer);
  return { entry: "queryResults", rows, first, painted: first !== null && text.includes(first) };
})().catch((error) => ({ entry: "queryResults", rows: 0, first: null, painted: false, error: String(error) }))`;

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
    const after = await waitForTabs(
      port,
      (tabs) =>
        tabs.timeOrigin !== selected.timeOrigin &&
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
    const growth = (key: "frame" | "worker" | "host") =>
      (samples[samples.length - 1][key] - samples[0][key]) / samples[0][key];
    console.log(
      `FPU_WEBVIEW_HEAP=${JSON.stringify({
        host,
        rows,
        growth: {
          frame: growth("frame"),
          worker: growth("worker"),
          host: growth("host"),
        },
        samples,
      })}`,
    );
  });
});

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
 * Once the datagrid has painted rows of the `rows`-row result, the used heap of the query results frame, of its
 * Perspective worker, and of this extension host.
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
    `Perspective never loaded ${rows} rows and painted the first`,
  );
  await sleep(2_000);
  const workers = await readWorkerHeaps(port, RESULTS.entry);
  assert.ok(workers.length > 0, "the Perspective worker should be attached");
  return {
    tableRows: grid!.rows,
    frame: (await readWebviewHeap(port, RESULTS.entry)).usedSize,
    worker: workers.reduce((sum, { usedSize }) => sum + usedSize, 0),
    workers: workers.length,
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
