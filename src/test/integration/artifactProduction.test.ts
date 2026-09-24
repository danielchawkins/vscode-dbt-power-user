import * as assert from "assert";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { checkFusionVersion } from "./helpers/testFixtures";
import { waitForExtensionActivation } from "./helpers/workspaceHelper";

/**
 * Proves the extension actually drives Fusion end to end in the integration
 * workspace: activation parses the project, and the CLI-backed model commands
 * (compile/build) write the artifacts a Consumer Repository would expect under
 * target/. Runs against the single-project fixture copy that runTests.ts opens
 * as the workspace root (models/base.sql has no deps; models/child.sql refs it).
 */

const ACTIVATION_TIMEOUT_MS = 20_000;
const COMMAND_ARTIFACT_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
  description: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  assert.ok(predicate(), `Timed out waiting for: ${description}`);
}

function workspaceRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "Integration workspace must have a folder open");
  return folder.uri.fsPath;
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<
    string,
    unknown
  >;
}

suite("Artifact production (extension)", function () {
  this.timeout(60_000);

  const fusionVerdict = checkFusionVersion();

  suiteSetup(async function () {
    if (fusionVerdict.kind !== "ok") {
      console.warn(
        "Skipping artifact production tests: dbt Fusion 2.0.5+ required on PATH.",
      );
      this.skip();
      return;
    }
    await waitForExtensionActivation(ACTIVATION_TIMEOUT_MS);
  });

  suiteTeardown(async function () {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("activation parses the project: target/manifest.json exists with the fixture's models", async function () {
    const root = workspaceRoot();
    const manifestPath = path.join(root, "target", "manifest.json");

    await waitUntil(
      () => fs.existsSync(manifestPath),
      ACTIVATION_TIMEOUT_MS,
      "target/manifest.json to exist after activation",
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

  test("dbt commands resolve profiles from the workspace, not the developer's home directory", function () {
    const root = workspaceRoot();
    const dbtLog = path.join(root, "logs", "dbt.log");
    assert.ok(
      fs.existsSync(dbtLog),
      "Fusion should have written logs/dbt.log during activation",
    );

    const contents = fs.readFileSync(dbtLog, "utf-8");
    const homeDir = os.homedir();
    const homeDbtDir = path.join(homeDir, ".dbt");
    // Fusion logs the literal string "~/.dbt" (tilde unexpanded) when it reads
    // the default profiles location, so the expanded home path alone would
    // never appear in the log even when the leak happens. Assert against both
    // spellings to catch the real failure mode and any future change in how
    // Fusion renders that path.
    const literalHomeDbtDir = "~/.dbt";
    assert.ok(
      !contents.includes(literalHomeDbtDir) && !contents.includes(homeDbtDir),
      "dbt.log must never reference the developer's home directory profiles " +
        `(saw "${literalHomeDbtDir}" or "${homeDbtDir}"); the harness points ` +
        "the profiles directories at the workspace and starts the host " +
        "without the developer's shell environment, so dbt's own cascade " +
        "must select the fixture's profiles.yml",
    );
  });

  test("compileCurrentModel writes compiled SQL for the active model", async function () {
    const root = workspaceRoot();
    const childPath = path.join(root, "models", "child.sql");
    const compiledPath = path.join(
      root,
      "target",
      "compiled",
      "single_project",
      "models",
      "child.sql",
    );
    fs.rmSync(compiledPath, { force: true });

    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(childPath),
    );
    await vscode.window.showTextDocument(document);

    await vscode.commands.executeCommand("fusionPowerUser.compileCurrentModel");

    await waitUntil(
      () => fs.existsSync(compiledPath),
      COMMAND_ARTIFACT_TIMEOUT_MS,
      "target/compiled/single_project/models/child.sql to exist",
    );
    const compiled = fs.readFileSync(compiledPath, "utf-8");
    assert.ok(
      compiled.includes("base"),
      "compiled child.sql must resolve the ref to base",
    );
  });

  test("buildCurrentModel materializes the model and writes run_results.json", async function () {
    const root = workspaceRoot();
    const basePath = path.join(root, "models", "base.sql");
    const runResultsPath = path.join(root, "target", "run_results.json");
    const previousMtimeMs = fs.existsSync(runResultsPath)
      ? fs.statSync(runResultsPath).mtimeMs
      : 0;

    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(basePath),
    );
    await vscode.window.showTextDocument(document);

    await vscode.commands.executeCommand("fusionPowerUser.buildCurrentModel");

    await waitUntil(
      () =>
        fs.existsSync(runResultsPath) &&
        fs.statSync(runResultsPath).mtimeMs > previousMtimeMs,
      COMMAND_ARTIFACT_TIMEOUT_MS,
      "target/run_results.json to be rewritten by buildCurrentModel",
    );

    const runResults = readJson(runResultsPath);
    const results = runResults.results as {
      unique_id: string;
      status: string;
    }[];
    const baseResult = results.find(
      (result) => result.unique_id === "model.single_project.base",
    );
    assert.ok(baseResult, "run_results.json must report the base model");
    assert.strictEqual(baseResult?.status, "success");

    // Confirm the relation actually materialized in DuckDB, not just that dbt
    // reported success — query it back through the CLI (no duckdb npm binding
    // is available to this workspace). Pass no profiles flag and inherit this
    // process's environment so the check resolves its profile exactly as the
    // extension's own invocations do.
    const show = spawnSync(
      "dbt",
      ["show", "--select", "base", "--limit", "1", "--output", "json"],
      { cwd: root, encoding: "utf-8", timeout: 5_000 },
    );
    assert.strictEqual(
      show.status,
      0,
      `dbt show --select base must succeed against the materialized relation: ${show.stderr}`,
    );
  });
});
