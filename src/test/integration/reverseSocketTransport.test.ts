import * as assert from "assert";
import { checkFusionVersion, fixturePath } from "./helpers/testFixtures";
import { createLspFixture } from "./lspFixture";

suite("reverse-socket transport integration", function () {
  this.timeout(30_000);

  const fusionVerdict = checkFusionVersion();

  suiteSetup(function () {
    if (fusionVerdict.kind !== "ok") {
      console.warn(
        "Skipping reverse-socket integration: dbt Fusion is required on PATH.",
      );
      this.skip();
    }
  });

  test("completes pre-load initialize over production transport", async function () {
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

      assert.ok(result.capabilities.completionProvider);
      assert.ok(result.capabilities.hoverProvider);
      assert.ok(result.capabilities.definitionProvider);
      assert.ok(result.capabilities.renameProvider);
      assert.ok(result.capabilities.documentFormattingProvider);
      assert.ok(result.capabilities.codeActionProvider);
      assert.ok(result.capabilities.semanticTokensProvider);
    } finally {
      await fixture.close();
    }
  });
});
