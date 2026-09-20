import * as assert from "assert";
import "reflect-metadata";
import * as vscode from "vscode";
import { checkFusionVersion, fixturePath } from "./helpers/testFixtures";
import {
  closeAllEditors,
  waitForExtensionActivation,
} from "./helpers/workspaceHelper";
import { createLspFixture } from "./lspFixture";

suite("Extension Integration Tests", function () {
  this.timeout(30_000);

  const fusionVerdict = checkFusionVersion();

  suiteSetup(function () {
    const pinned =
      fusionVerdict.kind === "ok" &&
      fusionVerdict.version.major === 2 &&
      fusionVerdict.version.minor === 0 &&
      fusionVerdict.version.patch === 5;
    if (!pinned) {
      console.warn(
        "Skipping Fusion integration tests: dbt Fusion 2.0.5 is required on PATH.",
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

  test("dbt lsp reverse-socket connect succeeds", async function () {
    const projectRoot = fixturePath("single-project");
    const fixture = await createLspFixture(projectRoot, projectRoot);

    try {
      await fixture.connect(5_000);

      const result = await fixture.request<{
        capabilities: Record<string, unknown>;
      }>("initialize", {
        processId: process.pid,
        rootPath: projectRoot,
        capabilities: {},
      });

      assert.ok(
        result.capabilities,
        "initialize response should include capabilities",
      );

      assert.ok(
        result.capabilities.completionProvider,
        "should advertise completionProvider",
      );

      assert.ok(
        result.capabilities.hoverProvider,
        "should advertise hoverProvider",
      );

      assert.ok(
        result.capabilities.definitionProvider,
        "should advertise definitionProvider",
      );
    } finally {
      await fixture.close();
    }
  });
});
