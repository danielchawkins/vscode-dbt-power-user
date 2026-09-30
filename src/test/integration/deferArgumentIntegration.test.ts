import * as assert from "assert";
import { execFile as execFileCb } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import { readDbtProjectFile, resolveProjectSnapshot } from "../../core/project";
import { DBTTerminal } from "../../dbt_integration";
import { CommandProcessExecutionFactory } from "../../fusion/commandProcessExecution";
import { FusionCli } from "../../fusion/fusionCli";
import { checkFusionVersion, getExtensionRoot } from "./helpers/testFixtures";

const execFile = promisify(execFileCb);

/**
 * Blocking `spawnSync` calls stall the extension host's event loop long enough that VS Code's
 * unresponsive-extension-host watchdog kills the process mid-test; run dbt asynchronously instead.
 */
async function runDbt(
  args: string[],
): Promise<{ status: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFile("dbt", args, {
      encoding: "utf-8",
    });
    return { status: 0, stdout, stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      status: failure.code ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? String(error),
    };
  }
}

function silentTerminal(): DBTTerminal {
  return {
    debug: () => undefined,
    log: () => undefined,
    error: () => undefined,
    warn: () => undefined,
    info: () => undefined,
    trace: () => undefined,
    show: () => Promise.resolve(),
  } as unknown as DBTTerminal;
}

function writeProject(projectDir: string): void {
  fs.mkdirSync(path.join(projectDir, "models"), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "dbt_project.yml"),
    [
      "name: defer_verify",
      'version: "1.0.0"',
      "config-version: 2",
      "profile: defer_verify",
      'model-paths: ["models"]',
      "",
    ].join("\n"),
  );
  // An absolute path here matters: dbt resolves a relative profile `path` against the
  // invocation's cwd, not --project-dir, which previously leaked defer_verify.duckdb into
  // whatever directory happened to be cwd (the repo root, for a spawnSync without cwd set).
  const databasePath = path.join(projectDir, "defer_verify.duckdb");
  fs.writeFileSync(
    path.join(projectDir, "profiles.yml"),
    [
      "defer_verify:",
      "  target: dev",
      "  outputs:",
      "    dev:",
      "      type: duckdb",
      `      path: ${databasePath}`,
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(projectDir, "models", "model_a.sql"),
    "select 1 as id\n",
  );
  fs.writeFileSync(
    path.join(projectDir, "models", "model_b.sql"),
    "select id from {{ ref('model_a') }}\n",
  );
}

/**
 * Exercises the defer arguments `FusionCli` builds from a project snapshot against the real, mise-pinned Fusion binary rather than fixture-backed
 * captured state. `src/test/fixtures/**` is being converted to working DuckDB projects in a
 * parallel change; this test builds its own throwaway project instead of depending on that.
 */
suite("Fusion defer argument integration", function () {
  this.timeout(60_000);

  let projectDir: string;
  let stateDir: string;

  suiteSetup(function () {
    const verdict = checkFusionVersion();
    if (verdict.kind !== "ok") {
      console.warn(
        "Skipping Fusion defer integration test: dbt Fusion 2.0.5+ is required on PATH.",
      );
      this.skip();
    }
  });

  setup(function () {
    projectDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "fusion-defer-integration-"),
    );
    stateDir = path.join(projectDir, "state");
    writeProject(projectDir);
  });

  teardown(function () {
    fs.rmSync(projectDir, { recursive: true, force: true });

    const leaked = fs
      .readdirSync(getExtensionRoot())
      .filter((entry) => entry.endsWith(".duckdb"));
    assert.deepStrictEqual(
      leaked,
      [],
      `no *.duckdb file should leak into the repo root, found: ${leaked.join(", ")}`,
    );
  });

  function buildCli(): FusionCli {
    const terminal = silentTerminal();
    const folder = path.dirname(projectDir);
    const snapshot = resolveProjectSnapshot({
      root: projectDir,
      folder,
      firstWorkspaceFolder: folder,
      userHome: os.homedir(),
      environment: process.env as Record<string, string>,
      lspCompiledOutputOverride: undefined,
      settings: {
        dbtPath: undefined,
        target: undefined,
        profilesDir: projectDir,
        staticAnalysis: undefined,
        lspCompiledOutput: undefined,
        lintEnabled: undefined,
        traceServer: undefined,
        deferPerProject: {
          [path.basename(projectDir)]: {
            deferToProduction: true,
            favorState: true,
            manifestPathForDeferral: stateDir,
          },
        },
        runParams: [],
        buildParams: [],
        testParams: [],
      },
      projectFile: readDbtProjectFile(projectDir),
    });
    return new FusionCli(
      { path: "dbt", env: {} },
      () => snapshot,
      new CommandProcessExecutionFactory(terminal),
      terminal,
    );
  }

  test("runs a deferred model successfully once its dependency's table already exists", async function () {
    const build = await runDbt([
      "run",
      "--project-dir",
      projectDir,
      "--profiles-dir",
      projectDir,
    ]);
    assert.strictEqual(
      build.status,
      0,
      `initial dbt run failed: ${build.stdout}\n${build.stderr}`,
    );

    const parse = await runDbt([
      "parse",
      "--project-dir",
      projectDir,
      "--profiles-dir",
      projectDir,
      "--target-path",
      stateDir,
    ]);
    assert.strictEqual(
      parse.status,
      0,
      `dbt parse into state dir failed: ${parse.stdout}\n${parse.stderr}`,
    );
    assert.ok(
      fs.existsSync(path.join(stateDir, "manifest.json")),
      "dbt parse should produce a manifest in the state directory",
    );

    const cli = buildCli();
    const command = cli.prepare({ kind: "run", select: "model_b" });
    assert.ok(
      command.getCommandAsString().includes(`--defer --state ${stateDir}`),
      `expected --defer --state ${stateDir} in: ${command.getCommandAsString()}`,
    );
    assert.ok(
      command.getCommandAsString().includes("--favor-state"),
      `expected --favor-state in: ${command.getCommandAsString()}`,
    );

    const result = await command.execute();
    assert.ok(
      !result.stdout?.includes("Encountered an error:"),
      `deferred run should succeed: ${result.stdout}\n${result.stderr}`,
    );
  });
});
