import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { HARNESS_SWITCHES } from "../../settings/environment";
import { ActivationMetric, readActivationMetric } from "./activationReport";
import {
  assertNoWorkbenchNotifications,
  captureWorkbenchScreenshot,
  evaluatePanel,
  evaluateWorkbench,
  readCspViolations,
  readWorkbenchNotificationTexts,
  validateSmokeHost,
  waitForWebviewPaint,
  WebviewPaintMetric,
} from "./cdpClient";
import { currentFixtureName } from "./fixtureContext";
import {
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
        "models/child.sql open with jinja-sql highlighting and the Execute Query | Document code lens on line 1",
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

    const panels = [
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
    const webviews: MeasuredWebview[] = [];

    for (const panel of panels) {
      assert.ok(
        registeredCommands.includes(panel.command),
        `${panel.command} should be registered`,
      );
      if (runtimeEnabled) {
        webviews.push(await openMeasuredPanel(cdpPort, panel));
      } else {
        await openPanel(panel);
        await sleep(2_000);
      }
      if (evidence) {
        const paint = await waitForWebviewPaint(cdpPort, panel.entry, 50);
        await evidence.capture({
          name: `panel ${panel.entry}`,
          expect: `The ${panel.entry} panel is visible and its text matches measured.bodyText`,
          measured: {
            bodyText: paint.bodyText,
            stylesheets: paint.stylesheets,
            cspViolations: await readCspViolations(cdpPort, panel.entry),
          },
        });
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
          grid.text.includes("one") && grid.text.includes("two"),
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
});

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
  panel: { container?: string; command: string; entry: string },
): Promise<MeasuredWebview> {
  let error: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await openPanel(panel);
    try {
      return {
        ...(await waitForWebviewPaint(cdpPort, panel.entry, 50)),
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
  return {
    entry: document.body.dataset.entry,
    viewer: Boolean(viewer),
    text: viewer ? textOf(viewer).slice(0, 300) : "",
    wasmCompile,
  };
})()`;

async function renderPerspectiveResult(
  cdpPort: string,
): Promise<{ viewer: boolean; text: string; wasmCompile?: string }> {
  let last: { viewer: boolean; text: string; wasmCompile?: string } = {
    viewer: false,
    text: "",
  };
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const panel = await evaluatePanel<{
      entry: string;
      viewer: boolean;
      text: string;
      wasmCompile: string;
    }>(cdpPort, "queryResults", RENDER_RESULT);
    if (panel) {
      const { entry: _entry, ...value } = panel.value;
      last = value;
      if (last.text.includes("one") && last.text.includes("two")) {
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

  const output = await showProjectOutput(cdpPort, host, root);
  await evidence.capture({
    name: "project output channel",
    expect:
      "The Output panel shows the Fusion Power User: single_project channel with Fusion client and dbt log lines",
    measured: output,
  });
  assert.strictEqual(
    output.shown,
    PROJECT_CHANNEL,
    `Show output must select ${PROJECT_CHANNEL} in the Output view`,
  );
  assert.ok(output.text, "the project channel must show Fusion log lines");
  await vscode.commands.executeCommand("workbench.action.closePanel");
}

const PROJECT_CHANNEL = "Fusion Power User: single_project";

/** Runs the language status item's "Show output" command, then reads the Output view until it shows the project channel. */
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
}> {
  const openedBy = "fusionPowerUser.showFusionOutput";
  await vscode.commands.executeCommand(openedBy, root);
  let last: {
    channel: string | null;
    shown: string | null;
    listed: string[];
    text: string;
  } | null = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    last =
      (await evaluateWorkbench<{
        channel: string | null;
        shown: string | null;
        listed: string[];
        text: string;
      }>(cdpPort, host, OUTPUT_VIEW)) ?? last;
    if (last?.shown === PROJECT_CHANNEL && last.text) {
      break;
    }
    await sleep(250);
  }
  return {
    channel: last?.channel ?? null,
    shown: last?.shown ?? null,
    listed: last?.listed ?? [],
    text: last?.text || null,
    openedBy,
  };
}

/**
 * Screenshot checkpoints when `FPU_SMOKE_SCREENSHOTS` names a directory; undefined otherwise. Each checkpoint also
 * records the workbench notification texts at capture time so the image and the text measurements can be compared.
 */
function visualEvidence(cdpPort: string, host: string) {
  const dir = screenshotDirectory();
  if (!dir) {
    return undefined;
  }
  let sequence = 0;
  return {
    async capture(checkpoint: VisualCheckpoint): Promise<void> {
      await sleep(500);
      const png = await captureWorkbenchScreenshot(cdpPort, host);
      const notifications = await readWorkbenchNotificationTexts(cdpPort, host);
      sequence += 1;
      const file = writeCheckpoint(
        path.join(dir, host, currentFixtureName() ?? "unknown-fixture"),
        sequence,
        { ...checkpoint, measured: { ...checkpoint.measured, notifications } },
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
