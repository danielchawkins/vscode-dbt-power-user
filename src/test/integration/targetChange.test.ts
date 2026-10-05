import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  FUSION_CLIENT_STATES_COMMAND,
  FusionClientStateReport,
} from "../../projects/fusionClientDiagnostics";

/**
 * Pins that a `fusionPowerUser.target` change applies without a reload: the project's Fusion Client
 * relaunches with the new target and the next CLI command runs against it. The fixture's `ci` output is a
 * DuckDB file named `probe_ci`, so compiled SQL names `probe_ci` as its database only under that target.
 */
const MODE = process.env.FPU_NATIVE_EDITOR_MODE;
const TIMEOUT_MS = 60_000;

suite(
  "A target change applies to the client and the next CLI command",
  function () {
    this.timeout(5 * 60_000);
    let projectDir = "";
    let compiled = "";

    suiteSetup(function () {
      projectDir = vscode.workspace.workspaceFolders![0].uri.fsPath;
      compiled = path.join(
        projectDir,
        "target",
        "compiled",
        "lineage_probe",
        "models",
        "stg_orders.sql",
      );
    });

    suiteTeardown(async function () {
      await vscode.workspace
        .getConfiguration("fusionPowerUser")
        .update("target", undefined, vscode.ConfigurationTarget.Workspace);
      await untilClient(
        "target reset",
        (client) => client.state === "running" && client.target === undefined,
      );
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    });

    /** Polls the single project's client report until `done` holds, logging each distinct report. */
    async function untilClient(
      step: string,
      done: (client: FusionClientStateReport) => boolean,
    ): Promise<FusionClientStateReport> {
      const start = Date.now();
      let last: FusionClientStateReport | undefined;
      let logged = "";
      while (Date.now() < start + TIMEOUT_MS) {
        const reports = await vscode.commands.executeCommand<
          FusionClientStateReport[]
        >(FUSION_CLIENT_STATES_COMMAND);
        last = reports[0];
        const seen = JSON.stringify(last);
        if (seen !== logged) {
          logged = seen;
          console.log(`[${MODE}] ${step} +${Date.now() - start}ms: ${seen}`);
        }
        if (last && done(last)) {
          return last;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      assert.fail(`${step}: client stayed ${JSON.stringify(last)}`);
    }

    async function untilCompiled(
      step: string,
      done: (sql: string) => boolean,
    ): Promise<string> {
      const start = Date.now();
      let last = "";
      while (Date.now() < start + TIMEOUT_MS) {
        last = fs.existsSync(compiled)
          ? fs.readFileSync(compiled, "utf-8")
          : "";
        if (done(last)) {
          console.log(
            `[${MODE}] ${step} +${Date.now() - start}ms: ${last.trim()}`,
          );
          return last;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      assert.fail(
        `${step}: compiled stg_orders.sql stayed ${JSON.stringify(last)}`,
      );
    }

    test("relaunches the client with --target ci and compiles against ci", async function () {
      const before = await untilClient(
        "initial",
        (client) => client.state === "running",
      );
      assert.strictEqual(
        before.target,
        undefined,
        "the fixture launches with the profile's default target",
      );

      await vscode.window.showTextDocument(
        vscode.Uri.file(path.join(projectDir, "models", "stg_orders.sql")),
      );
      fs.rmSync(compiled, { force: true });
      await vscode.commands.executeCommand(
        "fusionPowerUser.compileCurrentModel",
      );
      await untilCompiled("compile before change", (sql) =>
        sql.includes('"probe"."main"'),
      );

      await vscode.workspace
        .getConfiguration("fusionPowerUser")
        .update("target", "ci", vscode.ConfigurationTarget.Workspace);
      await untilClient(
        "target ci",
        (client) => client.state === "running" && client.target === "ci",
      );

      fs.rmSync(compiled, { force: true });
      await vscode.commands.executeCommand(
        "fusionPowerUser.compileCurrentModel",
      );
      await untilCompiled("compile after change", (sql) =>
        sql.includes('"probe_ci"."main"'),
      );
    });
  },
);
