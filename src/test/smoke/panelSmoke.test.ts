import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import "reflect-metadata";
import * as vscode from "vscode";

const EXTENSION_ID = "danielchawkins.fusion-power-user";

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

  test("activates installed VSIX and invokes retained panel commands", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, "packaged extension should be installed");
    await ext.activate();
    assert.ok(ext.isActive, "packaged extension should activate");

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

    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "fixture workspace should be open");
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.joinPath(folder.uri, "models/child.sql"),
    );
    await vscode.window.showTextDocument(doc);

    const contributedCommand = "dbtPowerUser.viewInDocEditor";
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes(contributedCommand),
      `${contributedCommand} should be registered`,
    );
    await vscode.commands.executeCommand(contributedCommand);

    const panelCommands = [
      {
        container: "workbench.view.extension.dbt_preview_results",
        focus: "dbtPowerUser.PreviewResults.focus",
      },
      {
        container: "workbench.view.extension.lineage_view",
        focus: "dbtPowerUser.Lineage.focus",
      },
    ];

    await vscode.commands.executeCommand("workbench.action.togglePanel");
    for (const panel of panelCommands) {
      await vscode.commands.executeCommand(panel.container);
      await vscode.commands.executeCommand(panel.focus);
      await sleep(2_000);
    }

    console.log(
      `FPU_SMOKE_PANELS=${JSON.stringify({
        invoked: [
          contributedCommand,
          ...panelCommands.map((panel) => panel.focus),
        ],
      })}`,
    );
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
