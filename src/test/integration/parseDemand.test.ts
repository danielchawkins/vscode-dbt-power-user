import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { dbtInvocations, dbtInvocationsSince } from "./helpers/dbtSpy";
import { checkFusionVersion } from "./helpers/testFixtures";
import { waitForExtensionActivation } from "./helpers/workspaceHelper";

/**
 * Pins the parse rule: a source change spawns no `dbt parse` while no parse-field view is showing, and opening the
 * documentation editor afterwards spawns exactly one. Runs against the spy wrapper the integration runner installs.
 */
const SETTLE_MS = 4_000;
const DEADLINE_MS = 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const parses = (since: number) => dbtInvocationsSince(since, "parse");

suite("dbt parse only while a parse-field view is showing", function () {
  this.timeout(3 * 60_000);
  const verdict = checkFusionVersion();
  let scratch = "";

  suiteSetup(async function () {
    if (
      verdict.kind !== "ok" ||
      process.env.FPU_SYMLINKED_WORKSPACE === "1" ||
      process.env.FPU_NATIVE_EDITOR_MODE !== undefined ||
      !process.env.FPU_DBT_SPY_LOG
    ) {
      this.skip();
      return;
    }
    await waitForExtensionActivation(30_000);
    const folder = vscode.workspace.workspaceFolders![0].uri.fsPath;
    scratch = path.join(folder, "models", "parse_demand_scratch.sql");
  });

  suiteTeardown(async function () {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    if (scratch) {
      fs.rmSync(scratch, { force: true });
    }
  });

  test("a save spawns no parse until the documentation editor opens, which spawns one", async function () {
    await vscode.commands.executeCommand("workbench.action.closeSidebar");
    await sleep(SETTLE_MS);
    const before = dbtInvocations().length;

    fs.writeFileSync(scratch, "select 1 as id\n");
    await sleep(SETTLE_MS);
    assert.deepStrictEqual(
      parses(before),
      [],
      "a source change must not spawn dbt parse while no parse-field view is showing",
    );

    await vscode.commands.executeCommand(
      "fusionPowerUser.goToDocumentationEditor",
    );
    const deadline = Date.now() + DEADLINE_MS;
    while (parses(before).length === 0 && Date.now() < deadline) {
      await sleep(250);
    }
    await sleep(SETTLE_MS);
    assert.strictEqual(
      parses(before).length,
      1,
      `opening the documentation editor must spawn exactly one parse; saw ${JSON.stringify(parses(before))}`,
    );
  });
});
