import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  FUSION_CLIENT_STATES_COMMAND,
  FusionClientStateReport,
} from "../../projects/fusionClientDiagnostics";
import { HARNESS_SWITCHES } from "../../settings/environment";
import { ActivationMetric, readActivationMetric } from "./activationReport";
import {
  assertNoWorkbenchNotifications,
  captureWorkbenchScreenshot,
  evaluatePanel,
  evaluateWorkbench,
  readCspViolations,
  readWorkbenchNotificationTexts,
  revealWorkbench,
  validateSmokeHost,
  waitForWebviewPaint,
  WebviewPaintMetric,
} from "./cdpClient";
import { currentFixtureName } from "./fixtureContext";
import {
  checkpointCount,
  screenshotDirectory,
  VisualCheckpoint,
  writeCheckpoint,
} from "./visualEvidence";

const EXTENSION_ID = "danielchawkins.fusion-power-user";
const RUNTIME_TIMINGS_COMMAND = "fusionPowerUser.test.getRuntimeTimings";

interface HostRuntimeTiming {
  entry: string;
  resolveStart: number;
  ready: number;
  duration: number;
}

interface MeasuredWebview extends WebviewPaintMetric {
  openAttempts: number;
}

suite("Pinned-host VSIX smoke", function () {
  this.timeout(120_000);

  test("reports host runtime versions", () => {
    const payload = {
      host: process.env[HARNESS_SWITCHES.smokeHost] ?? "unknown",
      node: process.versions.node,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      v8: process.versions.v8,
    };
    console.log(`FPU_SMOKE_RUNTIME=${JSON.stringify(payload)}`);
    assert.ok(
      process.versions.electron,
      "extension host should expose Electron",
    );
  });

  test("activates the VSIX and opens retained panels", async function () {
    if (currentFixtureName() !== "single-project") {
      this.skip();
      return;
    }
    const cdpPort = process.env.FPU_CDP_PORT;
    assert.ok(cdpPort, "smoke requires CDP port");
    const smokeHost = validateSmokeHost(
      process.env[HARNESS_SWITCHES.smokeHost] ?? "",
    );

    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, "packaged extension should be installed");
    const api = await ext.activate();
    await api.ready;
    assert.ok(ext.isActive, "packaged extension should activate");
    await assertNoWorkbenchNotifications(cdpPort, smokeHost);

    const extRoot = ext.extensionUri.fsPath;
    for (const asset of [
      "webview_panels/dist/assets/manifest.json",
      ...["documentationEditor", "queryResults", "lineage"].flatMap((entry) => [
        `webview_panels/dist/assets/${entry}.js`,
        `webview_panels/dist/assets/${entry}.css`,
      ]),
      "webview_panels/dist/assets/codicons/codicon.css",
      "webview_panels/dist/assets/codicons/codicon.ttf",
    ]) {
      assert.ok(
        fs.existsSync(path.join(extRoot, asset)),
        `VSIX should ship ${asset}`,
      );
    }

    const runtimeEnabled =
      process.env[HARNESS_SWITCHES.runtimeBenchmark] === "1";
    const evidence = visualEvidence(cdpPort, smokeHost);

    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "fixture workspace should be open");
    await assertParsedWithConfiguredProfiles(folder.uri.fsPath);
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.joinPath(folder.uri, "models/child.sql"),
    );
    await vscode.window.showTextDocument(doc);
    const modelLanguage = await waitForActiveLanguage("jinja-sql");
    assert.strictEqual(
      modelLanguage,
      "jinja-sql",
      "a model under model-paths must open as jinja-sql",
    );
    // openTextDocument resolves the language from associations alone; no editor or extension switch is involved.
    const unopened = await vscode.workspace.openTextDocument(
      vscode.Uri.joinPath(folder.uri, "models/broken_ref.sql"),
    );
    assert.strictEqual(
      unopened.languageId,
      "jinja-sql",
      "an unopened model must resolve to jinja-sql from contributed filename patterns",
    );
    await evidence?.capture({
      name: "model editor",
      expect:
        "models/child.sql open with jinja-sql highlighting and no code lens on line 1",
      measured: { languageId: modelLanguage, lineCount: doc.lineCount },
    });
    if (evidence) {
      await captureEditorSurfaces(evidence, cdpPort, smokeHost, folder.uri);
      await vscode.window.showTextDocument(doc);
    }

    const contributedCommand = "fusionPowerUser.viewInDocEditor";
    const registeredCommands = await vscode.commands.getCommands(true);
    assert.ok(
      registeredCommands.includes(contributedCommand),
      `${contributedCommand} should be registered`,
    );
    await vscode.commands.executeCommand(contributedCommand);

    const panels = PANELS;
    const webviews: MeasuredWebview[] = [];

    for (const panel of panels) {
      assert.ok(
        registeredCommands.includes(panel.command),
        `${panel.command} should be registered`,
      );
      if (runtimeEnabled) {
        webviews.push(await openMeasuredPanel(cdpPort, smokeHost, panel));
      } else {
        await openPanel(panel);
        await sleep(2_000);
      }
      if (evidence) {
        const paint = await waitForWebviewPaint(
          cdpPort,
          smokeHost,
          panel.entry,
        );
        await evidence.capture(
          {
            name: `panel ${panel.entry}`,
            expect: `The ${panel.entry} panel is visible and its text matches measured.bodyText`,
            measured: {
              bodyText: paint.bodyText,
              stylesheets: paint.stylesheets,
              cspViolations: await readCspViolations(cdpPort, panel.entry),
            },
          },
          async () => {
            const now = await waitForPanelTheme(cdpPort, panel.entry);
            return now ? { bodyText: now.bodyText, ready: now.ready } : {};
          },
        );
      }
      if (panel.entry === "queryResults") {
        const grid = await renderPerspectiveResult(cdpPort);
        await evidence?.capture({
          name: "query results grid",
          expect:
            "The query results panel shows a Perspective datagrid with columns n and label and rows 1 one, 2 two",
          measured: grid,
        });
        assert.ok(
          perspectiveRendered(grid),
          `Perspective must render the result rows: ${JSON.stringify({
            ...grid,
            cspViolations: await readCspViolations(cdpPort, panel.entry),
          })}`,
        );
      }
      const violations = await readCspViolations(cdpPort, panel.entry);
      assert.deepStrictEqual(
        violations,
        [],
        `${panel.entry} must load without CSP violations`,
      );
    }

    console.log(
      `FPU_SMOKE_PANELS=${JSON.stringify({
        invoked: [contributedCommand, ...panels.map(({ command }) => command)],
      })}`,
    );

    await assertNoWorkbenchNotifications(cdpPort, smokeHost);

    if (runtimeEnabled) {
      const hostTimings = await waitForHostRuntimeTimings();
      const activation: ActivationMetric = await readActivationMetric();
      assert.ok(
        typeof api.readyMs === "number",
        "extension API should report readyMs after ready settles",
      );
      console.log(
        `FPU_RUNTIME_SAMPLE=${JSON.stringify({
          host: smokeHost,
          activation: { ...activation, startupReady: api.readyMs },
          webviews: webviews.map(
            ({ entry, timeOrigin, firstContentfulPaint, openAttempts }) => ({
              entry,
              timeOrigin,
              firstContentfulPaint,
              openAttempts,
            }),
          ),
          hostTimings,
        })}`,
      );
    }
  });

  test("renders each panel in the light, dark and high-contrast themes", async function () {
    const cdpPort = process.env.FPU_CDP_PORT;
    if (currentFixtureName() !== "single-project" || !cdpPort) {
      this.skip();
      return;
    }
    const smokeHost = validateSmokeHost(
      process.env[HARNESS_SWITCHES.smokeHost] ?? "",
    );
    const evidence = visualEvidence(cdpPort, smokeHost);
    // The documentation editor follows the active editor; an earlier test may have moved focus off the model.
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "fixture workspace should be open");
    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(
        vscode.Uri.joinPath(folder.uri, "models/child.sql"),
      ),
    );
    await waitForActiveLanguage("jinja-sql");
    const workbench = vscode.workspace.getConfiguration("workbench");
    const windowConfig = vscode.workspace.getConfiguration("window");
    const original = workbench.inspect<string>("colorTheme")?.globalValue;
    const originalDetect = windowConfig.inspect<boolean>(
      "autoDetectColorScheme",
    )?.globalValue;
    // Cursor follows the OS color scheme by default, which overrides `workbench.colorTheme`.
    await windowConfig.update(
      "autoDetectColorScheme",
      false,
      vscode.ConfigurationTarget.Global,
    );
    try {
      for (const theme of THEMES) {
        await workbench.update(
          "colorTheme",
          theme.name,
          vscode.ConfigurationTarget.Global,
        );
        const activeKind = await waitForColorThemeKind(theme.kind);
        for (const panel of PANELS) {
          await openPanel(panel);
          const read = (): Promise<PanelTheme | undefined> =>
            waitForPanelTheme(cdpPort, panel.entry, theme.bodyClass);
          const measure = async () => ({
            theme: theme.name,
            activeKind: vscode.ColorThemeKind[activeKind],
            ...(await read()),
          });
          const styles = await read();
          const graph = await openLineageColumns(cdpPort, panel.entry);
          await evidence?.capture(
            {
              name: `${theme.label} ${panel.entry}`,
              expect: themeExpectation(panel.entry, theme.name),
              measured: {},
            },
            async () => ({
              ...(await measure()),
              ...(graph ? { graph: await readLineageGraph(cdpPort) } : {}),
            }),
          );
          assertLineageDrawn(graph, theme.name);
          assert.strictEqual(
            styles?.bodyClass,
            theme.bodyClass,
            `${panel.entry} must render under ${theme.name}`,
          );
          assert.ok(
            styles?.ready,
            `${panel.entry} content must render under ${theme.name}: ${styles?.bodyText}`,
          );
          assert.notStrictEqual(
            styles?.color,
            styles?.background,
            `${panel.entry} text must differ from its background under ${theme.name}`,
          );
          assert.deepStrictEqual(
            await readCspViolations(cdpPort, panel.entry),
            [],
            `${panel.entry} must load without CSP violations under ${theme.name}`,
          );
        }
      }
    } finally {
      await workbench.update(
        "colorTheme",
        original,
        vscode.ConfigurationTarget.Global,
      );
      await windowConfig.update(
        "autoDetectColorScheme",
        originalDetect,
        vscode.ConfigurationTarget.Global,
      );
    }
  });
});

const PANELS = [
  {
    container: "workbench.view.extension.docs_edit_view",
    command: "fusionPowerUser.DocsEdit.focus",
    entry: "documentationEditor",
  },
  {
    container: "workbench.view.extension.dbt_preview_results",
    command: "fusionPowerUser.PreviewResults.focus",
    entry: "queryResults",
  },
  {
    container: "workbench.view.extension.lineage_view",
    command: "fusionPowerUser.Lineage.focus",
    entry: "lineage",
  },
];

const THEMES = [
  {
    label: "light",
    name: "Default Light Modern",
    bodyClass: "vscode-light",
    kind: vscode.ColorThemeKind.Light,
  },
  {
    label: "dark",
    name: "Default Dark Modern",
    bodyClass: "vscode-dark",
    kind: vscode.ColorThemeKind.Dark,
  },
  {
    label: "high contrast",
    name: "Default High Contrast",
    bodyClass: "vscode-high-contrast",
    kind: vscode.ColorThemeKind.HighContrast,
  },
];

/** The workbench's color theme kind once it is `kind`, or the last kind seen after the wait. */
async function waitForColorThemeKind(
  kind: vscode.ColorThemeKind,
): Promise<vscode.ColorThemeKind> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (vscode.window.activeColorTheme.kind === kind) {
      break;
    }
    await sleep(250);
  }
  return vscode.window.activeColorTheme.kind;
}

interface PanelTheme {
  entry: string;
  bodyClass: string;
  color: string;
  background: string;
  buttonBackground: string | null;
  bodyText: string;
  ready: boolean;
}

/** Records the page's React Flow warnings in `window.fpuLineageWarnings`; installed once per lineage page. */
const CAPTURE_LINEAGE_WARNINGS = `
  if (document.body.dataset.entry === "lineage" && !window.fpuLineageWarnings) {
    window.fpuLineageWarnings = [];
    const warn = console.warn.bind(console);
    console.warn = (...args) => {
      const text = args.map(String).join(" ");
      if (text.includes("React Flow")) window.fpuLineageWarnings.push(text.slice(0, 300));
      warn(...args);
    };
  }`;

/**
 * The page's theme class, the computed colors of its body and first button, and whether its content has loaded.
 * On the lineage page it first installs the React Flow warning capture, so the capture precedes the first draw.
 */
const READ_PANEL_THEME = `(() => {${CAPTURE_LINEAGE_WARNINGS}
  const body = document.body;
  const kind = ["vscode-high-contrast", "vscode-dark", "vscode-light"].find((c) => body.classList.contains(c)) ?? "";
  const style = getComputedStyle(body);
  const button = document.querySelector("button");
  const text = body.innerText.trim();
  const ready = {
    documentationEditor: () => text.includes("Model:"),
    queryResults: () => !!document.querySelector("perspective-viewer") || /welcome/i.test(text),
    lineage: () => !!document.querySelector(".react-flow__node"),
  }[body.dataset.entry]?.() ?? false;
  return {
    entry: body.dataset.entry,
    bodyClass: kind,
    color: style.color,
    background: style.backgroundColor,
    buttonBackground: button ? getComputedStyle(button).backgroundColor : null,
    bodyText: text.slice(0, 100),
    ready,
  };
})()`;

interface LineageGraph {
  entry: string;
  nodes: number;
  edges: number;
  columnLists: number;
  columns: string;
  tables: string[];
  /** React Flow warnings the page logged since it was first reached. */
  warnings: string[];
}

/** The drawn tables, table and column edges, and open column lists of the lineage graph. */
const READ_LINEAGE_GRAPH = `(() => {
  if (document.body.dataset.entry !== "lineage") return null;
  const lists = [...document.querySelectorAll("[data-testid=lineage-columns]")];
  return {
    entry: "lineage",
    nodes: document.querySelectorAll(".react-flow__node").length,
    edges: document.querySelectorAll(".react-flow__edge").length,
    columnLists: lists.length,
    columns: lists.map((l) => l.innerText.replace(/\\s+/g, " ").trim()).join(" | ").slice(0, 200),
    tables: [...document.querySelectorAll("[data-table]")].map((n) => n.dataset.table),
    warnings: (window.fpuLineageWarnings ?? []).slice(-10),
  };
})()`;

/** Opens the start table's column list unless one is open, the way a click on its Columns button does. */
const OPEN_LINEAGE_COLUMNS = `(() => {
  if (document.body.dataset.entry !== "lineage") return null;
  if (!document.querySelector("[data-testid=lineage-columns]")) {
    const start = document.querySelector("[data-table$='.child']") ?? document.querySelector("[data-table]");
    const button = [...(start?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === "Columns");
    button?.click();
  }
  return { entry: "lineage" };
})()`;

async function readLineageGraph(
  cdpPort: string,
): Promise<LineageGraph | undefined> {
  return (
    await evaluatePanel<LineageGraph>(cdpPort, "lineage", READ_LINEAGE_GRAPH)
  )?.value;
}

/** Opens a column list in the lineage graph and waits until it and an edge are drawn; undefined for other panels. */
async function openLineageColumns(
  cdpPort: string,
  entry: string,
): Promise<LineageGraph | undefined> {
  if (entry !== "lineage") {
    return undefined;
  }
  let last: LineageGraph | undefined;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await evaluatePanel(cdpPort, "lineage", OPEN_LINEAGE_COLUMNS);
    last = (await readLineageGraph(cdpPort)) ?? last;
    if (last && last.columnLists > 0 && last.edges > 0) {
      break;
    }
    await sleep(250);
  }
  return last;
}

function themeExpectation(entry: string, theme: string): string {
  return entry === "lineage"
    ? `The lineage graph follows ${theme}: table nodes child and broken_ref joined by an edge, with child's column list open`
    : `The ${entry} panel follows ${theme}: its text and controls use the theme's colors`;
}

function assertLineageDrawn(graph: LineageGraph | undefined, theme: string) {
  if (graph) {
    assert.ok(
      graph.nodes >= 2 && graph.edges >= 1 && graph.columnLists >= 1,
      `lineage must draw nodes, an edge and a column list under ${theme}: ${JSON.stringify(graph)}`,
    );
    assert.deepStrictEqual(
      graph.warnings,
      [],
      `lineage must draw without React Flow warnings under ${theme}`,
    );
  }
}

/** Waits until the panel's panel-specific content has rendered and, when given, its body carries `bodyClass`. */
async function waitForPanelTheme(
  cdpPort: string,
  entry: string,
  bodyClass?: string,
): Promise<PanelTheme | undefined> {
  let last: PanelTheme | undefined;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    last =
      (await evaluatePanel<PanelTheme>(cdpPort, entry, READ_PANEL_THEME))
        ?.value ?? last;
    if ((!bodyClass || last?.bodyClass === bodyClass) && last?.ready) {
      break;
    }
    await sleep(250);
  }
  return last;
}

async function waitForHostRuntimeTimings(): Promise<HostRuntimeTiming[]> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const timings = await vscode.commands.executeCommand<HostRuntimeTiming[]>(
      RUNTIME_TIMINGS_COMMAND,
    );
    if (timings?.length === 3) {
      return timings;
    }
    await sleep(100);
  }
  throw new Error("Expected resolve-to-ready timing for all three webviews");
}

async function openMeasuredPanel(
  cdpPort: string,
  host: string,
  panel: { container?: string; command: string; entry: string },
): Promise<MeasuredWebview> {
  let error: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await openPanel(panel);
    try {
      return {
        ...(await waitForWebviewPaint(cdpPort, host, panel.entry, 20_000)),
        openAttempts: attempt + 1,
      };
    } catch (cause) {
      error = cause;
    }
  }
  throw error;
}

async function openPanel(panel: {
  container?: string;
  command: string;
}): Promise<void> {
  if (panel.container) {
    await vscode.commands.executeCommand(panel.container);
  }
  await vscode.commands.executeCommand(panel.command);
}

async function waitForActiveLanguage(
  languageId: string,
): Promise<string | undefined> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const current = vscode.window.activeTextEditor?.document.languageId;
    if (current === languageId) {
      return current;
    }
    await sleep(100);
  }
  return vscode.window.activeTextEditor?.document.languageId;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Evidence = NonNullable<ReturnType<typeof visualEvidence>>;

/** Posts a two-row result into the query results page as the host would, then reads the grid Perspective draws. */
const RENDER_RESULT = `(async () => {
  if (document.body.dataset.entry !== "queryResults") return null;
  if (!globalThis.__fpuResultPosted) {
    globalThis.__fpuResultPosted = true;
    window.dispatchEvent(new MessageEvent("message", { data: {
      command: "renderQuery",
      columnNames: ["n", "label"],
      columnTypes: ["Integer", "Text"],
      rows: [{ n: 1, label: "one" }, { n: 2, label: "two" }],
      raw_sql: "select 1",
      compiled_sql: "select 1",
    } }));
  }
  const textOf = (node) => {
    const parts = [];
    const walk = (n) => {
      if (n.nodeName === "TD" || n.nodeName === "TH") parts.push(n.textContent);
      if (n.shadowRoot) walk(n.shadowRoot);
      n.childNodes.forEach(walk);
    };
    walk(node);
    return parts.join(" ").replace(/\\s+/g, " ").trim();
  };
  const viewer = document.querySelector("perspective-viewer");
  // The smallest valid module; the page's CSP alone decides whether it compiles.
  const wasmCompile = await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))
    .then(() => "ok", (error) => String(error));
  // The datagrid paints only rows that fit the viewport; the table holds every row.
  let labels = [];
  try {
    const table = await viewer?.getTable();
    const view = await table?.view({ columns: ["label"] });
    labels = (await view?.to_columns())?.label ?? [];
    await view?.delete();
  } catch {}
  return {
    entry: document.body.dataset.entry,
    viewer: Boolean(viewer),
    text: viewer ? textOf(viewer).slice(0, 300) : "",
    labels,
    wasmCompile,
  };
})()`;

type PerspectiveResult = {
  viewer: boolean;
  text: string;
  labels: string[];
  wasmCompile?: string;
};

/** True when the table holds both rows and the grid painted at least the first. */
function perspectiveRendered(result: PerspectiveResult): boolean {
  return (
    result.labels.includes("one") &&
    result.labels.includes("two") &&
    result.text.includes("one")
  );
}

async function renderPerspectiveResult(
  cdpPort: string,
): Promise<PerspectiveResult> {
  let last: PerspectiveResult = { viewer: false, text: "", labels: [] };
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const panel = await evaluatePanel<PerspectiveResult & { entry: string }>(
      cdpPort,
      "queryResults",
      RENDER_RESULT,
    );
    if (panel) {
      const { entry: _entry, ...value } = panel.value;
      last = value;
      if (perspectiveRendered(last)) {
        break;
      }
    }
    await sleep(250);
  }
  return last;
}

const LANGUAGE_STATUS_HOVER = `(() => {
  const hover = document.querySelector(".workbench-hover, .monaco-hover:not(.hidden)");
  if (!hover || !hover.innerText.trim()) {
    const entry = document.getElementById("status.languageStatus");
    (entry?.querySelector("a") ?? entry)?.click();
    return null;
  }
  return hover.innerText.trim();
})()`;

const CLOSE_HOVER = `(() => {
  const target = document.activeElement ?? document.body;
  for (const type of ["keydown", "keyup"]) {
    target.dispatchEvent(new KeyboardEvent(type, { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
  }
  return true;
})()`;

/** The rows of the Parent Models and Children Models views, by view name. */
const TREE_ROWS = `(() => {
  const out = {};
  for (const name of ["Parent Models", "Children Models"]) {
    const header = [...document.querySelectorAll(".pane-header")].find((h) => h.textContent.includes(name));
    const pane = header?.closest(".pane");
    out[name] = pane ? [...pane.querySelectorAll(".monaco-list-row")].map((r) => r.getAttribute("aria-label")) : null;
  }
  return out;
})()`;

/** Opens models/child.sql and the dbt view container, and records the Parent and Children trees. */
async function captureModelTrees(
  evidence: Evidence,
  cdpPort: string,
  host: string,
): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "fixture workspace should be open");
  await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument(
      vscode.Uri.joinPath(folder.uri, "models/child.sql"),
    ),
  );
  await vscode.commands.executeCommand("workbench.view.extension.dbt_view");
  await sleep(1_500);
  await evidence.capture({
    name: "model trees",
    expect:
      "The Parent Models and Children Models views are expanded for models/child.sql; each lists its graph neighbours or one line explaining why the graph is empty",
    measured: {
      rows: (await evaluateWorkbench(cdpPort, host, TREE_ROWS)) ?? null,
    },
  });
}

const EXPLORER_ROWS = `[...document.querySelectorAll(".explorer-folders-view .monaco-list-row")].map((row) => {
  const label = row.querySelector(".monaco-icon-label");
  const icon = label && getComputedStyle(label, "::before");
  return {
    name: row.getAttribute("aria-label"),
    classes: label ? [...label.classList].filter((c) => /lang-file-icon|ext-file-icon|name-file-icon/.test(c)) : [],
    iconBackground: icon ? icon.backgroundImage : null,
  };
})`;

const OUTPUT_VIEW = `(() => {
  const view = document.querySelector(".output-view, [id='workbench.panel.output']");
  if (!view) return null;
  const container = view.closest(".part") ?? document;
  const labels = [...container.querySelectorAll("select, .monaco-select-box, [aria-label], [title]")]
    .flatMap((e) => [
      e.tagName === "SELECT" ? e.options[e.selectedIndex]?.text : undefined,
      e.getAttribute("title"),
      e.getAttribute("aria-label"),
      e.textContent,
    ])
    .filter((t) => t && t.startsWith("Fusion Power User: "));
  const lines = view.querySelector(".view-lines")?.innerText ?? "";
  const shown = [...container.querySelectorAll("select")].map((s) => s.options[s.selectedIndex]?.text).find(Boolean)
    ?? container.querySelector(".monaco-select-box")?.getAttribute("title") ?? null;
  const listed = [...container.querySelectorAll("select option")].map((o) => o.text)
    .filter((t) => t.startsWith("Fusion Power User"));
  return { channel: labels[0] ?? null, shown, listed, text: labels.length ? lines.trim().slice(0, 600) : "" };
})()`;

/** Checkpoints for the language status items, the explorer's dbt file icons and the project output channel. */
async function captureEditorSurfaces(
  evidence: Evidence,
  cdpPort: string,
  host: string,
  root: vscode.Uri,
): Promise<void> {
  let hoverText: string | undefined;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    hoverText =
      (await evaluateWorkbench<string>(cdpPort, host, LANGUAGE_STATUS_HOVER)) ??
      undefined;
    if (hoverText?.includes("dbt Fusion") && !hoverText.includes("starting")) {
      break;
    }
    await sleep(500);
  }
  await evidence.capture({
    name: "language status",
    expect:
      "The {} language status hover lists dbt Fusion (single_project) with a check, static analysis mode, and Show output",
    measured: { hoverText: hoverText ?? null },
  });

  await evaluateWorkbench(cdpPort, host, CLOSE_HOVER);
  await sleep(300);

  await vscode.commands.executeCommand(
    "revealInExplorer",
    vscode.Uri.joinPath(root, "dbt_project.yml"),
  );
  await vscode.commands.executeCommand(
    "revealInExplorer",
    vscode.Uri.joinPath(root, "models/child.sql"),
  );
  await sleep(1_000);
  await evidence.capture({
    name: "explorer icons",
    expect:
      "The explorer shows models/*.sql with the dbt file icon and dbt_project.yml with its theme icon",
    measured: {
      rows: (await evaluateWorkbench(cdpPort, host, EXPLORER_ROWS)) ?? null,
    },
  });

  await captureNonProjectSql(evidence, cdpPort, host);

  await captureModelTrees(evidence, cdpPort, host);

  const output = await showProjectOutput(cdpPort, host, root);
  await evidence.capture({
    name: "project output channel",
    expect:
      "The Output panel shows the Fusion Power User: single_project channel with Fusion client and dbt log lines",
    measured: output,
  });
  assert.strictEqual(
    output.clientState,
    "running",
    `the ${PROJECT_NAME} Fusion client must be running before its channel is read`,
  );
  assert.strictEqual(
    output.shown,
    PROJECT_CHANNEL,
    `Show output must select ${PROJECT_CHANNEL} in the Output view`,
  );
  assert.ok(output.text, "the project channel must show Fusion log lines");
  await vscode.commands.executeCommand("workbench.action.closePanel");
}

const EDITOR_TITLE_ACTIONS = `(() => {
  const labels = [...document.querySelectorAll(".editor-actions .action-label")]
    .map((e) => e.getAttribute("aria-label") || e.getAttribute("title") || "");
  return labels.filter((l) => /execute dbt sql|run dbt model|test dbt model|build dbt model|compiled dbt preview/i.test(l));
})()`;

/** A SQL file outside every Declared Project has no dbt editor-title action; an untitled SQL editor keeps them. */
async function captureNonProjectSql(
  evidence: Evidence,
  cdpPort: string,
  host: string,
): Promise<void> {
  const outside = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "fpu-")),
    "outside.sql",
  );
  fs.writeFileSync(outside, "select 1\n");
  await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument(outside),
  );
  await sleep(1_000);
  const outsideActions =
    (await evaluateWorkbench<string[]>(cdpPort, host, EDITOR_TITLE_ACTIONS)) ??
    [];
  await evidence.capture({
    name: "non-project sql",
    expect:
      "A .sql file outside every Declared Project shows no dbt editor-title action",
    measured: { actions: outsideActions },
  });
  assert.deepStrictEqual(
    outsideActions,
    [],
    "no dbt editor-title action outside a project",
  );

  const untitled = await vscode.workspace.openTextDocument({
    language: "sql",
    content: "select 1\n",
  });
  await vscode.window.showTextDocument(untitled);
  await sleep(1_000);
  const untitledActions =
    (await evaluateWorkbench<string[]>(cdpPort, host, EDITOR_TITLE_ACTIONS)) ??
    [];
  await evidence.capture({
    name: "untitled sql",
    expect: "An untitled SQL editor shows the dbt editor-title actions",
    measured: { actions: untitledActions },
  });
  assert.ok(
    untitledActions.length > 0,
    "untitled SQL keeps the dbt editor-title actions",
  );
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
}

const PROJECT_NAME = "single_project";
const PROJECT_CHANNEL = `Fusion Power User: ${PROJECT_NAME}`;
const OUTPUT_TIMEOUT_MS = 30_000;

/**
 * Waits for the project's Fusion client to run, so its channel has log lines, then runs the language status item's
 * "Show output" command and reads the Output view until it renders that channel's lines.
 */
async function showProjectOutput(
  cdpPort: string,
  host: string,
  root: vscode.Uri,
): Promise<{
  channel: string | null;
  shown: string | null;
  listed: string[];
  text: string | null;
  openedBy: string;
  clientState: string | null;
}> {
  const clientState = await waitForClientRunning(PROJECT_NAME);
  const openedBy = "fusionPowerUser.showFusionOutput";
  await vscode.commands.executeCommand(openedBy, root);
  let last: {
    channel: string | null;
    shown: string | null;
    listed: string[];
    text: string;
  } | null = null;
  const deadline = Date.now() + OUTPUT_TIMEOUT_MS;
  do {
    await revealWorkbench(cdpPort, host, deadline - Date.now());
    try {
      last =
        (await evaluateWorkbench<{
          channel: string | null;
          shown: string | null;
          listed: string[];
          text: string;
        }>(cdpPort, host, OUTPUT_VIEW)) ?? last;
    } catch {
      // A starved renderer can miss the evaluation timeout; retry until the deadline.
    }
    if (last?.shown === PROJECT_CHANNEL && last.text) {
      break;
    }
    await sleep(250);
  } while (Date.now() < deadline);
  return {
    channel: last?.channel ?? null,
    shown: last?.shown ?? null,
    listed: last?.listed ?? [],
    text: last?.text || null,
    openedBy,
    clientState,
  };
}

/** The Fusion client state of `projectName` once it is running or failed, or the last state seen at the timeout. */
async function waitForClientRunning(
  projectName: string,
): Promise<string | null> {
  const deadline = Date.now() + OUTPUT_TIMEOUT_MS;
  let state: string | null = null;
  do {
    const reports = await vscode.commands.executeCommand<
      FusionClientStateReport[]
    >(FUSION_CLIENT_STATES_COMMAND);
    state =
      reports?.find((report) => report.projectName === projectName)?.state ??
      null;
    if (state === "running" || state === "failed") {
      return state;
    }
    await sleep(250);
  } while (Date.now() < deadline);
  return state;
}

/**
 * Screenshot checkpoints when `FPU_SMOKE_SCREENSHOTS` names a directory; undefined otherwise. Each checkpoint also
 * records the workbench notification texts at capture time so the image and the text measurements can be compared.
 * `remeasure` runs immediately before the screenshot and its result is merged over `checkpoint.measured`.
 */
function visualEvidence(cdpPort: string, host: string) {
  const dir = screenshotDirectory();
  if (!dir) {
    return undefined;
  }
  const fixtureDir = path.join(
    dir,
    host,
    currentFixtureName() ?? "unknown-fixture",
  );
  let sequence = checkpointCount(fixtureDir);
  return {
    async capture(
      checkpoint: VisualCheckpoint,
      remeasure?: () => Promise<Record<string, unknown>>,
    ): Promise<void> {
      await sleep(500);
      await revealWorkbench(cdpPort, host);
      const measured = {
        ...checkpoint.measured,
        ...(await remeasure?.()),
      };
      const png = await captureWorkbenchScreenshot(cdpPort, host);
      const notifications = await readWorkbenchNotificationTexts(cdpPort, host);
      sequence += 1;
      const file = writeCheckpoint(
        fixtureDir,
        sequence,
        { ...checkpoint, measured: { ...measured, notifications } },
        png,
        {
          host,
          fixture: currentFixtureName(),
          activeEditor:
            vscode.window.activeTextEditor?.document.uri.fsPath ?? null,
          capturedAt: new Date().toISOString(),
        },
      );
      console.log(`FPU_SMOKE_SCREENSHOT=${file}`);
    },
  };
}

/**
 * The harness points `fusionPowerUser.profilesDir` at the fixture profiles and the environment at a decoy.
 * A manifest listing the fixture's models proves the extension's parse honoured the setting.
 */
async function assertParsedWithConfiguredProfiles(root: string): Promise<void> {
  const manifestPath = path.join(root, "target", "manifest.json");
  const deadline = Date.now() + 30_000;
  while (!fs.existsSync(manifestPath) && Date.now() < deadline) {
    await sleep(250);
  }
  const dbtLog = path.join(root, "logs", "dbt.log");
  const log = fs.existsSync(dbtLog) ? fs.readFileSync(dbtLog, "utf-8") : "";
  assert.ok(
    fs.existsSync(manifestPath),
    "the extension's dbt parse must write target/manifest.json using fusionPowerUser.profilesDir; " +
      `dbt.log tail: ${log.slice(-800)}`,
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
    nodes: Record<string, unknown>;
  };
  assert.ok(
    "model.single_project.child" in manifest.nodes,
    "manifest must contain the fixture's child model",
  );
  assert.ok(
    !log.includes("decoy-profiles-"),
    "dbt read the decoy profiles directory from the environment instead of fusionPowerUser.profilesDir",
  );
}
