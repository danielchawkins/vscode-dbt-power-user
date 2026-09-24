import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import "reflect-metadata";
import * as vscode from "vscode";
import { ActivationMetric, readActivationMetric } from "./activationReport";
import {
  assertNoWorkbenchNotifications,
  validateSmokeHost,
  waitForWebviewPaint,
  WebviewPaintMetric,
} from "./cdpClient";
import { currentFixtureName } from "./fixtureContext";

const EXTENSION_ID = "danielchawkins.fusion-power-user";
const RUNTIME_TIMINGS_COMMAND = "fusionPowerUser.test.getRuntimeTimings";

interface HostRuntimeTiming {
  viewPath: string;
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
      host: process.env.FPU_SMOKE_HOST ?? "unknown",
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
    const smokeHost = validateSmokeHost(process.env.FPU_SMOKE_HOST ?? "");

    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, "packaged extension should be installed");
    await ext.activate();
    assert.ok(ext.isActive, "packaged extension should activate");
    await assertNoWorkbenchNotifications(cdpPort, smokeHost);

    const extRoot = ext.extensionUri.fsPath;
    for (const asset of [
      "webview_panels/dist/assets/main.js",
      "webview_panels/dist/assets/main.css",
      "webview_panels/dist/assets/codicons/codicon.css",
      "webview_panels/dist/assets/codicons/codicon.ttf",
    ]) {
      assert.ok(
        fs.existsSync(path.join(extRoot, asset)),
        `VSIX should ship ${asset}`,
      );
    }

    const runtimeEnabled = process.env.FPU_RUNTIME_BENCHMARK === "1";

    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "fixture workspace should be open");
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.joinPath(folder.uri, "models/child.sql"),
    );
    await vscode.window.showTextDocument(doc);

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
        viewPath: "/docs-generator",
      },
      {
        container: "workbench.view.extension.dbt_preview_results",
        command: "fusionPowerUser.PreviewResults.focus",
        viewPath: "/query-panel",
      },
      {
        container: "workbench.view.extension.lineage_view",
        command: "fusionPowerUser.Lineage.focus",
        viewPath: "/lineage",
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
      console.log(
        `FPU_RUNTIME_SAMPLE=${JSON.stringify({
          host: smokeHost,
          activation,
          webviews: webviews.map(
            ({ viewPath, timeOrigin, firstContentfulPaint, openAttempts }) => ({
              viewPath,
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
  panel: { container?: string; command: string; viewPath: string },
): Promise<MeasuredWebview> {
  let error: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await openPanel(panel);
    try {
      return {
        ...(await waitForWebviewPaint(cdpPort, panel.viewPath, 50)),
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
