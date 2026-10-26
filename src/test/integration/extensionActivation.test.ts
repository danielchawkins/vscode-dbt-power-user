import * as assert from "node:assert";
import * as vscode from "vscode";
import { checkFusionVersion } from "./helpers/testFixtures";
import {
  closeAllEditors,
  waitForExtensionActivation,
} from "./helpers/workspaceHelper";

suite("Extension Integration Tests", function () {
  this.timeout(30_000);

  const fusionVerdict = checkFusionVersion();

  suiteSetup(function () {
    if (fusionVerdict.kind !== "ok") {
      console.warn(
        "Skipping Fusion integration tests: dbt Fusion 2.0.6 or later is required on PATH.",
      );
      this.skip();
    }
  });

  suiteTeardown(async function () {
    await closeAllEditors();
  });

  test("extension activates on single-project", async function () {
    await waitForExtensionActivation();

    const ext = vscode.extensions.getExtension(
      "danielchawkins.fusion-power-user",
    );
    assert.ok(ext, "Fusion Power User extension should be installed");
    assert.ok(ext.isActive, "Fusion Power User extension should be active");
  });
});
