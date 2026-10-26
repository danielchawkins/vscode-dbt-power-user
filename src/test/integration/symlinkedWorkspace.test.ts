import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { pollUntil } from "../async";
import { checkFusionVersion } from "./helpers/testFixtures";
import { waitForExtensionActivation } from "./helpers/workspaceHelper";

/**
 * Proves the Fusion LSP client works when the opened project root is a symlink, not its realpath. The `symlinked`
 * label opens `single-project-link`, a symlink to a fresh fixture copy.
 * Fusion matches document URIs literally, so without the client's realpath launch and URI converters the
 * definition request below returns nothing.
 */

const ACTIVATION_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 250;

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<
    string,
    unknown
  >;
}

suite("Symlinked workspace (extension)", function () {
  this.timeout(60_000);

  const fusionVerdict = checkFusionVersion();

  suiteSetup(async function () {
    if (process.env.FPU_SYMLINKED_WORKSPACE !== "1") {
      console.warn(
        "Skipping symlinked workspace tests: only runs in the `symlinked` " +
          "label (FPU_SYMLINKED_WORKSPACE=1), which opens the fixture " +
          "through a symlink.",
      );
      this.skip();
      return;
    }
    if (fusionVerdict.kind !== "ok") {
      console.warn(
        "Skipping symlinked workspace tests: dbt Fusion 2.0.6+ required on PATH.",
      );
      this.skip();
      return;
    }
    await waitForExtensionActivation(ACTIVATION_TIMEOUT_MS);
  });

  suiteTeardown(async function () {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("the opened workspace folder is the symlink, not its realpath", function () {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "Integration workspace must have a folder open");
    assert.strictEqual(
      path.basename(folder.uri.fsPath),
      "single-project-link",
      "The symlinked label must have opened the symlink path, proving this suite " +
        "actually exercises a symlinked project root",
    );
  });

  test("activation parses the project through the symlink: target/manifest.json exists with both models", async function () {
    const folder = vscode.workspace.workspaceFolders![0];
    const manifestPath = path.join(
      folder.uri.fsPath,
      "target",
      "manifest.json",
    );

    await pollUntil(
      () => fs.existsSync(manifestPath),
      (exists) => exists,
      {
        timeoutMs: ACTIVATION_TIMEOUT_MS,
        intervalMs: POLL_INTERVAL_MS,
        describe: "target/manifest.json to exist after activation",
      },
    );

    const manifest = readJson(manifestPath);
    const nodes = manifest.nodes as Record<string, unknown>;
    assert.ok(
      "model.single_project.base" in nodes,
      "manifest must contain the base model",
    );
    assert.ok(
      "model.single_project.child" in nodes,
      "manifest must contain the child model",
    );
  });

  test('definition on ref("base") in child.sql, opened via the symlink, resolves through the LSP', async function () {
    const folder = vscode.workspace.workspaceFolders![0];
    const childPath = path.join(folder.uri.fsPath, "models", "child.sql");
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(childPath),
    );
    await vscode.window.showTextDocument(document);

    const text = document.getText();
    const refIndex = text.indexOf('"base"');
    assert.ok(refIndex >= 0, 'child.sql fixture must contain ref("base")');
    const position = document.positionAt(refIndex + 1);

    // executeDefinitionProvider is async; poll it since the LSP may still be
    // indexing right after activation finishes.
    const locations = await pollUntil(
      () =>
        vscode.commands.executeCommand<
          vscode.Location[] | vscode.LocationLink[]
        >("vscode.executeDefinitionProvider", document.uri, position),
      (result) => (result?.length ?? 0) > 0,
      {
        timeoutMs: ACTIVATION_TIMEOUT_MS,
        intervalMs: POLL_INTERVAL_MS,
        describe: 'a definition location for ref("base")',
      },
    );

    assert.ok(
      locations && locations.length > 0,
      'expected at least one definition location for ref("base")',
    );

    const first = locations[0];
    const targetUri = "targetUri" in first ? first.targetUri : first.uri;
    assert.ok(
      targetUri.fsPath.includes("single-project-link"),
      `the definition must resolve under the symlinked root; got ${targetUri.fsPath}`,
    );
  });
});
