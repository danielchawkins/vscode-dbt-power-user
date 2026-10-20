import type { columnProposals } from "@fusion-power-user/webview-contract";
import * as assert from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { parse } from "yaml";

/**
 * Column type and description proposals on the native labels, through the test-only
 * `fusionPowerUser.test.columnProposals` command. `strict` runs the built, deferred, never-built and description
 * cases; `baseline` runs the never-built case and the description notice without strict analysis. Each model is in
 * `models/column_docs` of the native-editor fixture, whose schema.yml declares its columns.
 */

const MODE = process.env.FPU_NATIVE_EDITOR_MODE;
const COMMAND = "fusionPowerUser.test.columnProposals";
const ACCEPT_ALL_COMMAND = "fusionPowerUser.test.acceptAllColumnProposals";
const BUILT = "built_dev";
const PROD_ONLY = "prod_only";
const NEVER_BUILT = "never_built";
const UNION = "union_orders";
const JOIN = "order_join";
const NOT_BUILT_NOTICE =
  "`never_built` is not built in target `dev`, and no deferred relation is configured. Build it with `dbt run -s never_built`, set up defer, or use the inferred types.";
const NOT_IN_MANIFEST = "is not in the manifest";
const SOURCE = "source.lineage_probe.raw.orders";
const ORDER_TOTALS = "model.lineage_probe.order_totals";

type Payload = columnProposals.TypeProposalsPayload;
type DescriptionPayload = columnProposals.DescriptionProposalsPayload;
type ProposalKind = "types" | "descriptions";

function modelFile(projectDir: string, model: string): string {
  return path.join(projectDir, "models", "column_docs", `${model}.sql`);
}

/** The SQL file of a model in the fixture's `models` folder, outside `column_docs`. */
function rootModelFile(projectDir: string, model: string): string {
  return path.join(projectDir, "models", `${model}.sql`);
}

/** Whether the payload only says the parse has not published the model yet. */
function isNotInManifest(payload: { notice?: { message: string } }): boolean {
  return payload.notice?.message.includes(NOT_IN_MANIFEST) ?? false;
}

/** Retries until `done` holds, for the client start and the reanalysis after a settings change. */
async function until<T extends Payload | DescriptionPayload = Payload>(
  file: string,
  done: (payload: T) => boolean,
  kind: ProposalKind = "types",
): Promise<T> {
  const deadline = Date.now() + 120_000;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await vscode.commands.executeCommand<T | undefined>(
      COMMAND,
      kind,
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

  test("stg_orders takes the source descriptions of the columns it passes through", async () => {
    const payload = await until<DescriptionPayload>(
      rootModelFile(projectDir, "stg_orders"),
      (found) => !isNotInManifest(found),
      "descriptions",
    );
    const source = (column: string) => [{ uniqueId: SOURCE, column }];
    assert.deepStrictEqual(payload.proposals, [
      {
        column: "id",
        candidates: [
          { description: "Order primary key.", sources: source("id") },
        ],
      },
      {
        column: "customer_id",
        candidates: [
          { description: "Customer key.", sources: source("customer_id") },
        ],
      },
      {
        column: "amount",
        candidates: [
          {
            description: "Order amount in dollars.",
            sources: source("amount"),
          },
        ],
      },
      {
        column: "status",
        candidates: [
          { description: "Order status code.", sources: source("status") },
        ],
      },
      {
        column: "note",
        candidates: [
          {
            description: "Free-text note on the order.",
            sources: source("note"),
          },
        ],
      },
    ]);
  });

  test("totals_downstream.grand_total takes the description of order_totals.total", async () => {
    const payload = await until<DescriptionPayload>(
      rootModelFile(projectDir, "totals_downstream"),
      (found) => !isNotInManifest(found),
      "descriptions",
    );
    assert.deepStrictEqual(payload.proposals, [
      {
        column: "grand_total",
        candidates: [
          {
            description: "Sum of order amounts per customer.",
            sources: [{ uniqueId: ORDER_TOTALS, column: "total" }],
          },
        ],
      },
    ]);
  });

  test("order_totals: total is described and gets nothing, and last_status (max(status)) is a copy of status", async () => {
    const payload = await until<DescriptionPayload>(
      rootModelFile(projectDir, "order_totals"),
      (found) => !isNotInManifest(found),
      "descriptions",
    );
    assert.deepStrictEqual(payload.proposals, [
      {
        column: "last_status",
        candidates: [
          {
            description: "Order status code.",
            sources: [{ uniqueId: SOURCE, column: "status" }],
          },
        ],
      },
    ]);
  });

  test("the UNION column whose branches agree gets one candidate, and value, a mod in Fusion, gets none", async () => {
    const payload = await until<DescriptionPayload>(
      modelFile(projectDir, UNION),
      (found) => !isNotInManifest(found),
      "descriptions",
    );
    const candidatesOf = (column: string) =>
      payload.proposals
        .find((proposal) => proposal.column === column)
        ?.candidates.map((candidate) => candidate.description);
    assert.deepStrictEqual(candidatesOf("customer_id"), ["Customer key."]);
    assert.strictEqual(candidatesOf("value"), undefined);
  });

  test("the join's passthrough columns take the description of their copy ancestors", async () => {
    const payload = await until<DescriptionPayload>(
      modelFile(projectDir, JOIN),
      (found) => !isNotInManifest(found),
      "descriptions",
    );
    const source = (column: string) => [{ uniqueId: SOURCE, column }];
    assert.deepStrictEqual(payload.proposals, [
      {
        column: "order_id",
        candidates: [
          { description: "Order primary key.", sources: source("id") },
        ],
      },
      {
        column: "customer_id",
        candidates: [
          { description: "Customer key.", sources: source("customer_id") },
        ],
      },
      {
        column: "total",
        candidates: [
          {
            description: "Sum of order amounts per customer.",
            sources: [{ uniqueId: ORDER_TOTALS, column: "total" }],
          },
        ],
      },
    ]);
  });

  test("accept-all on the UNION model writes only the single-candidate description", async () => {
    const schema = path.join(projectDir, "models", "column_docs", "schema.yml");
    const original = readFileSync(schema, "utf-8");
    try {
      await vscode.commands.executeCommand(
        ACCEPT_ALL_COMMAND,
        "descriptions",
        modelFile(projectDir, UNION),
      );

      const models = parse(readFileSync(schema, "utf-8")).models as {
        name: string;
        columns: { name: string; data_type?: string; description?: string }[];
      }[];
      const union = models.find((model) => model.name === UNION);
      assert.deepStrictEqual(union?.columns, [
        { name: "customer_id", description: "Customer key." },
        { name: "value" },
      ]);
    } finally {
      writeFileSync(schema, original);
    }
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

  test("upstream descriptions need strict analysis, with the useStrictAnalysis action", async () => {
    const payload = await until<DescriptionPayload>(
      modelFile(projectDir, UNION),
      (found) => !isNotInManifest(found),
      "descriptions",
    );
    assert.deepStrictEqual(payload.proposals, []);
    assert.ok(
      payload.notice?.message.includes("strict static analysis"),
      payload.notice?.message,
    );
    assert.ok(
      payload.notice?.message.includes("fusionPowerUser.staticAnalysis"),
      payload.notice?.message,
    );
    assert.deepStrictEqual(payload.notice?.actions, [
      { title: "Use strict analysis", action: "useStrictAnalysis" },
    ]);
  });
});
