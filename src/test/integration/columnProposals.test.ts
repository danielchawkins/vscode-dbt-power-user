import type { columnProposals } from "@fusion-power-user/webview-contract";
import * as assert from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { parse } from "yaml";

/**
 * Column type proposals on the native labels, through the test-only `fusionPowerUser.test.columnProposals` command.
 * `strict` runs the built, deferred and never-built cases; `baseline` runs the never-built case without strict
 * analysis. Each model is in `models/column_docs` of the native-editor fixture, whose schema.yml declares its columns.
 */

const MODE = process.env.FPU_NATIVE_EDITOR_MODE;
const COMMAND = "fusionPowerUser.test.columnProposals";
const ACCEPT_ALL_COMMAND = "fusionPowerUser.test.acceptAllColumnProposals";
const BUILT = "built_dev";
const PROD_ONLY = "prod_only";
const NEVER_BUILT = "never_built";
const NOT_BUILT_NOTICE =
  "`never_built` is not built in target `dev`, and no deferred relation is configured. Build it with `dbt run -s never_built`, set up defer, or use the inferred types.";

type Payload = columnProposals.ColumnProposalsPayload;

function modelFile(projectDir: string, model: string): string {
  return path.join(projectDir, "models", "column_docs", `${model}.sql`);
}

/** Retries until `done` holds, for the client start and the reanalysis after a settings change. */
async function until(
  file: string,
  done: (payload: Payload) => boolean,
): Promise<Payload> {
  const deadline = Date.now() + 120_000;
  let last: Payload | undefined;
  while (Date.now() < deadline) {
    last = await vscode.commands.executeCommand<Payload | undefined>(
      COMMAND,
      "types",
      file,
    );
    if (last && done(last)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  assert.fail(`no matching proposals: ${JSON.stringify(last)}`);
}

suite("Column type proposals from the language server, strict", function () {
  this.timeout(5 * 60_000);
  let projectDir = "";

  suiteSetup(function () {
    if (MODE !== "strict") {
      this.skip();
      return;
    }
    projectDir = vscode.workspace.workspaceFolders![0].uri.fsPath;
  });

  test("a built model takes its types from the dev target", async () => {
    const dbt =
      vscode.workspace
        .getConfiguration("fusionPowerUser")
        .get<string>("dbtPath") ?? "dbt";
    const build = spawnSync(
      dbt,
      ["run", "-s", BUILT, "--profiles-dir", projectDir],
      { cwd: projectDir, encoding: "utf-8", timeout: 120_000 },
    );
    assert.strictEqual(
      build.status,
      0,
      `dbt run -s ${BUILT} failed:\n${build.stdout}${build.stderr}`,
    );

    const payload = await until(
      modelFile(projectDir, BUILT),
      (found) => found.source?.kind === "target",
    );
    const source = payload.source;
    assert.ok(source?.kind === "target");
    assert.strictEqual(source.target, "dev");
    assert.ok(source.relation.includes(BUILT), source.relation);
    assert.deepStrictEqual(
      payload.proposals.map((proposal) => ({
        ...proposal,
        type: proposal.type.toLowerCase(),
      })),
      [
        {
          column: "customer_id",
          type: "integer",
          change: "overwrite",
          current: "varchar",
        },
        { column: "order_count", type: "bigint", change: "add" },
        { column: "last_status", type: "varchar", change: "add" },
      ],
    );
    assert.deepStrictEqual(payload.notFound, ["ghost"]);
  });

  test("a deferred model takes its types from the prod state", async () => {
    const folder = vscode.workspace.workspaceFolders![0];
    const stateDir = path.join(projectDir, "state");
    const settings = vscode.workspace.getConfiguration(
      "fusionPowerUser",
      folder.uri,
    );
    await settings.update(
      "defer.perProject",
      {
        [path.relative(folder.uri.fsPath, projectDir)]: {
          deferToProduction: true,
          favorState: true,
          manifestPathForDeferral: stateDir,
        },
      },
      vscode.ConfigurationTarget.WorkspaceFolder,
    );
    try {
      const payload = await until(
        modelFile(projectDir, PROD_ONLY),
        (found) => found.source?.kind === "deferred",
      );
      const source = payload.source;
      assert.ok(source?.kind === "deferred");
      assert.ok(source.relation.includes(PROD_ONLY), source.relation);
      assert.strictEqual(source.state, stateDir);
      assert.deepStrictEqual(
        payload.proposals.map((proposal) => [proposal.column, proposal.change]),
        [
          ["customer_id", "fill"],
          ["total_amount", "fill"],
        ],
      );
    } finally {
      await settings.update(
        "defer.perProject",
        undefined,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
    }
  });

  test("a never-built model gets inferred types and the D8 notice", async () => {
    const payload = await until(
      modelFile(projectDir, NEVER_BUILT),
      (found) => found.source?.kind === "inferred",
    );
    assert.strictEqual(payload.source?.kind, "inferred");
    assert.strictEqual(payload.notice?.message, NOT_BUILT_NOTICE);
  });

  test("accept-all writes the built model's proposals to its schema.yml", async () => {
    const schema = path.join(projectDir, "models", "column_docs", "schema.yml");

    await vscode.commands.executeCommand(
      ACCEPT_ALL_COMMAND,
      "types",
      modelFile(projectDir, BUILT),
    );

    const models = parse(readFileSync(schema, "utf-8")).models as {
      name: string;
      columns: { name: string; data_type?: string; description?: string }[];
    }[];
    const built = models.find((model) => model.name === BUILT);
    assert.deepStrictEqual(built?.columns, [
      {
        name: "customer_id",
        data_type: "integer",
        description: "Customer key.",
      },
      { name: "ghost", data_type: "integer" },
      { name: "order_count", data_type: "bigint" },
      { name: "last_status", data_type: "varchar" },
    ]);
  });
});

suite("Column type proposals from the language server, baseline", function () {
  this.timeout(5 * 60_000);
  let projectDir = "";

  suiteSetup(function () {
    if (MODE !== "baseline") {
      this.skip();
      return;
    }
    projectDir = vscode.workspace.workspaceFolders![0].uri.fsPath;
  });

  test("a never-built model gets no proposals and a notice naming staticAnalysis", async () => {
    const payload = await until(
      modelFile(projectDir, NEVER_BUILT),
      (found) =>
        found.notice?.message.includes("fusionPowerUser.staticAnalysis") ===
        true,
    );
    assert.deepStrictEqual(payload.proposals, []);
    assert.ok(
      payload.notice?.message.includes("fusionPowerUser.staticAnalysis"),
      payload.notice?.message,
    );
  });
});
