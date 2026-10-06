import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "url";
import { isConfigError } from "../../core/cli";
import type { Log } from "../../core/log";
import {
  ProjectSnapshotSettings,
  readDbtProjectFile,
  resolveProjectSnapshot,
} from "../../core/project";
import { CommandProcessExecutionFactory } from "../../fusion/commandProcessExecution";
import { FusionCli } from "../../fusion/fusionCli";
import {
  CompileSignal,
  subscribeToCompileComplete,
  type ClientHandle,
} from "../../fusion/lspClientSupport";
import { errorHint } from "../../projects/projectErrors";
import { checkFusionVersion, fixturePath } from "./helpers/testFixtures";
import { createLspFixture } from "./lspFixture";

const MISSING = "FPU_MISSING_VAR";
const dbt = process.env.FPU_INTEGRATION_DBT_PATH ?? "dbt";

function silentTerminal(): Log {
  const noop = () => undefined;
  return {
    debug: noop,
    error: noop,
    warn: noop,
    info: noop,
    dispose: noop,
  };
}

const noSettings: ProjectSnapshotSettings = {
  dbtPath: undefined,
  target: undefined,
  profilesDir: undefined,
  staticAnalysis: undefined,
  lspCompiledOutput: undefined,
  lintEnabled: undefined,
  traceServer: undefined,
  deferPerProject: {},
  runParams: [],
  buildParams: [],
  testParams: [],
};

/** The config-errors fixture's `dbt parse` failures, against the real Fusion binary. */
suite("Configuration errors", function () {
  this.timeout(60_000);

  let projectDir: string;
  const environment = (extra: Record<string, string> = {}) => {
    const { [MISSING]: _unset, ...rest } = process.env as Record<
      string,
      string
    >;
    return { ...rest, ...extra };
  };

  function parseDiagnostics(
    settings: Partial<ProjectSnapshotSettings>,
    env: Record<string, string> = environment(),
  ) {
    const folder = path.dirname(projectDir);
    const snapshot = resolveProjectSnapshot({
      root: projectDir,
      folder,
      firstWorkspaceFolder: folder,
      userHome: os.homedir(),
      environment: env,
      lspCompiledOutputOverride: undefined,
      settings: { ...noSettings, profilesDir: projectDir, ...settings },
      projectFile: readDbtProjectFile(projectDir),
    });
    const terminal = silentTerminal();
    const cli = new FusionCli(
      { path: dbt, env: {} },
      () => snapshot,
      new CommandProcessExecutionFactory(terminal),
      terminal,
    );
    return cli.rebuildManifest().then(() => ({
      diagnostics: cli.getDiagnostics().rebuildManifestDiagnostics,
      invocation: snapshot.invocation,
    }));
  }

  suiteSetup(function () {
    if (
      checkFusionVersion().kind !== "ok" &&
      !process.env.FPU_INTEGRATION_DBT_PATH
    ) {
      console.warn(
        "Skipping configuration errors: dbt Fusion 2.0.6+ is required on PATH.",
      );
      this.skip();
    }
  });

  setup(function () {
    const temp = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "fpu-config-errors-"),
    );
    projectDir = path.join(temp, "config-errors");
    fs.cpSync(fixturePath("config-errors"), projectDir, { recursive: true });
  });

  teardown(function () {
    fs.rmSync(path.dirname(projectDir), { recursive: true, force: true });
  });

  test("a profile env_var with no default is one error on dbt_project.yml line 1, with the hint", async function () {
    const { diagnostics, invocation } = await parseDiagnostics({});
    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
    const [diagnostic] = diagnostics;
    assert.strictEqual(diagnostic.severity, "error");
    assert.strictEqual(
      diagnostic.filePath,
      path.join(projectDir, "dbt_project.yml"),
    );
    assert.strictEqual(diagnostic.range?.startLine, 0);
    assert.match(
      diagnostic.message,
      /environment variable 'FPU_MISSING_VAR' not found/,
    );
    assert.strictEqual(
      errorHint(diagnostic.message, invocation),
      "The editor's environment lacks FPU_MISSING_VAR. Start the editor from a shell that sets it, " +
        "or set it in your profile.",
    );
  });

  test("setting the variable clears the error", async function () {
    const { diagnostics } = await parseDiagnostics(
      {},
      environment({ [MISSING]: path.join(projectDir, "ok.duckdb") }),
    );
    assert.deepStrictEqual(diagnostics, []);
  });

  test("a profilesDir with no profiles.yml names the setting", async function () {
    const nowhere = path.join(projectDir, "no-such-dir");
    const { diagnostics, invocation } = await parseDiagnostics({
      profilesDir: nowhere,
    });
    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
    assert.match(diagnostics[0].message, /No profiles\.yml found/);
    assert.strictEqual(
      errorHint(diagnostics[0].message, invocation),
      `fusionPowerUser.profilesDir is ${nowhere}, which has no profiles.yml.`,
    );
  });

  test("an unknown target names the setting", async function () {
    const { diagnostics, invocation } = await parseDiagnostics(
      { target: "nope" },
      environment({ [MISSING]: path.join(projectDir, "ok.duckdb") }),
    );
    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
    assert.match(diagnostics[0].message, /target 'nope' not found in profile/);
    assert.strictEqual(
      errorHint(diagnostics[0].message, invocation),
      "fusionPowerUser.target is nope; set it to a target the profile defines.",
    );
  });

  test("the language server reports the missing variable as a configuration error", async function () {
    const compileErrors = (params: unknown): string[] => {
      let messages: string[] = [];
      const client = {
        onNotification: (method: string, handler: (p: unknown) => void) => {
          if (method === "dbt/lspCompileComplete") {
            handler(params);
          }
        },
      } as unknown as ClientHandle;
      subscribeToCompileComplete(client, new CompileSignal(), (m) => {
        messages = m;
      });
      return messages;
    };
    const fixture = await createLspFixture(projectDir, projectDir, {
      executable: dbt,
      env: environment(),
    });
    try {
      await fixture.connect(15_000);
      const root = fixture.projectRoot;
      await fixture.request("initialize", {
        processId: process.pid,
        rootUri: pathToFileURL(root).href,
        workspaceFolders: [
          { uri: pathToFileURL(root).href, name: "config-errors" },
        ],
        capabilities: {
          window: { workDoneProgress: true },
          workspace: { configuration: true },
        },
      });
      fixture.notify("initialized", {});
      void fixture
        .request("workspace/executeCommand", {
          command: "dbt.compileLsp",
          arguments: [],
        })
        .catch(() => undefined);
      const complete = await fixture.waitForNotification(
        "dbt/lspCompileComplete",
        (params) => compileErrors(params).length > 0,
        30_000,
      );
      const messages = compileErrors(complete);
      assert.ok(
        messages.some((m) => m.includes(MISSING) && isConfigError(m)),
        JSON.stringify(messages),
      );
    } finally {
      await fixture.close();
    }
  });
});
