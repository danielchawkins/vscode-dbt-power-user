import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ColumnLineage } from "../../core/lineage";
import {
  CONNECTED_COLUMNS_COMMAND,
  LINEAGE_COLUMNS_COMMAND,
} from "../../features/lineage/connectedColumnsCommand";
import type {
  ConnectedColumnsRequest,
  ConnectedColumnsResult,
} from "../../features/lineage/lineageService";
import { pollUntil } from "../async";

/**
 * Pins column lineage from the language server against the pinned dbt: the extension's service sends
 * `dbt.listNodes` to the project's Fusion Client, and a saved edit shows up downstream through `select *`
 * with no CLI compile, and the panel lists a model's columns from `dbt.getCurrentNode` with no YAML declaration.
 * Runs only in the `strict` native-editor launch; the extension sets the schema origin.
 * The fixture's setup run writes `target/`, so only the CLI lineage outputs are asserted absent.
 */
const MODE = process.env.FPU_NATIVE_EDITOR_MODE;
const ORDER_TOTALS = "model.lineage_probe.order_totals";
const TOTALS_STAR = "model.lineage_probe.totals_star";
const COLUMNS_PROBE = "model.lineage_probe.columns_probe";
const CLI_LINEAGE_OUTPUTS = [
  ["target", "info_schema"],
  ["target", "private", "metadata", "compile", "column_lineage"],
];

suite("Column lineage from the language server", function () {
  this.timeout(5 * 60_000);
  let projectDir = "";

  suiteSetup(function () {
    if (MODE !== "strict") {
      this.skip();
      return;
    }
    projectDir = vscode.workspace.workspaceFolders![0].uri.fsPath;
  });

  function assertNoCliLineage(): void {
    for (const parts of CLI_LINEAGE_OUTPUTS) {
      const written = path.join(projectDir, ...parts);
      assert.ok(!fs.existsSync(written), `${written} was written`);
    }
  }

  const request = (body: ConnectedColumnsRequest) =>
    vscode.commands.executeCommand<ConnectedColumnsResult>(
      CONNECTED_COLUMNS_COMMAND,
      body,
    );

  /** Retries until `done` holds, for the client start and the reanalysis after a save. */
  async function until(
    body: ConnectedColumnsRequest,
    done: (lineage: ColumnLineage[]) => boolean,
  ): Promise<ColumnLineage[]> {
    const last = await pollUntil(
      () => request(body),
      (result) => result?.kind === "lineage" && done(result.columnLineage),
      {
        timeoutMs: 120_000,
        intervalMs: 1_000,
        describe: (seen) => `no matching lineage: ${JSON.stringify(seen)}`,
      },
    );
    assert.ok(last?.kind === "lineage");
    return last.columnLineage;
  }

  const edges = (lineage: ColumnLineage[]) =>
    lineage.map(({ source, target, viewsType }) =>
      [...source, ...target, viewsType].join(" "),
    );

  async function save(file: string, text: string): Promise<void> {
    const uri = vscode.Uri.file(path.join(projectDir, "models", file));
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    await editor.edit((edit) =>
      edit.replace(
        new vscode.Range(
          document.positionAt(0),
          document.positionAt(document.getText().length),
        ),
        text,
      ),
    );
    await document.save();
  }

  test("lists inferred columns with types for models whose YAML declares none, including an unopened file", async function () {
    const file = path.join(projectDir, "models", "columns_probe.sql");
    fs.writeFileSync(
      file,
      "select customer_id, total from {{ ref('order_totals') }}\n",
    );
    try {
      await vscode.window.showTextDocument(
        vscode.Uri.file(path.join(projectDir, "models", "stg_orders.sql")),
      );
      assert.ok(
        !vscode.workspace.textDocuments.some((d) => d.uri.fsPath === file),
      );
      assert.deepStrictEqual(await columnsOf(ORDER_TOTALS), [
        "customer_id integer",
        "last_status character varying(256)",
        "n bigint",
        "total decimal(38, 2)",
      ]);
      assert.deepStrictEqual(await columnsOf(COLUMNS_PROBE), [
        "customer_id integer",
        "total decimal(38, 2)",
      ]);
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      fs.rmSync(file, { force: true });
    }
  });

  /** The panel's columns of `table` as `name datatype`, once the manifest and server know it. */
  async function columnsOf(table: string): Promise<string[]> {
    const body = await pollUntil(
      () =>
        vscode.commands.executeCommand<
          { columns: { name: string; datatype: string }[] } | undefined
        >(LINEAGE_COLUMNS_COMMAND, table),
      (found) => (found?.columns ?? []).length > 0,
      {
        timeoutMs: 120_000,
        intervalMs: 1_000,
        describe: `the panel's columns of ${table}`,
      },
    );
    return (body?.columns ?? []).map((c) => `${c.name} ${c.datatype}`);
  }

  /** Both directions requested together, reissued while the server cancels them to reanalyze the written file. */
  async function concurrentPair(): Promise<
    (ConnectedColumnsResult | undefined)[]
  > {
    return pollUntil(
      () =>
        Promise.all(
          [false, true].map((upstreamExpansion) =>
            request({ targets: [[ORDER_TOTALS, "total"]], upstreamExpansion }),
          ),
        ),
      (pair) =>
        !pair.some((result) =>
          (JSON.stringify(result) ?? "undefined").includes(
            "Operation cancelled",
          ),
        ),
      {
        timeoutMs: 60_000,
        intervalMs: 1_000,
        describe: "the concurrent requests to finish without cancellation",
      },
    );
  }

  test("answers concurrent upstream and downstream requests for one column", async function () {
    const star = path.join(projectDir, "models", "totals_star.sql");
    fs.writeFileSync(star, "select * from {{ ref('order_totals') }}\n");
    try {
      await vscode.window.showTextDocument(
        vscode.Uri.file(path.join(projectDir, "models", "order_totals.sql")),
      );
      await until(
        { targets: [[ORDER_TOTALS, "total"]], upstreamExpansion: true },
        (lineage) => lineage.length > 1,
      );
      const [upstream, downstream] = (await concurrentPair()).map((result) => {
        assert.ok(result?.kind === "lineage", JSON.stringify(result));
        return edges(result.columnLineage);
      });
      assert.ok(
        upstream.includes(
          `model.lineage_probe.stg_orders amount ${ORDER_TOTALS} total Transformation`,
        ),
        JSON.stringify(upstream),
      );
      assert.deepStrictEqual(
        downstream.map((edge) => edge.split(" ").slice(2, 4).join(".")).sort(),
        [
          "model.lineage_probe.order_join.total",
          "model.lineage_probe.totals_downstream.grand_total",
          `${TOTALS_STAR}.total`,
          "model.lineage_probe.union_orders.value",
        ],
      );
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      fs.rmSync(star, { force: true });
    }
  });

  test("reads a column's lineage and a saved edit through select *, with no CLI lineage output", async function () {
    const star = path.join(projectDir, "models", "totals_star.sql");
    const model = path.join(projectDir, "models", "order_totals.sql");
    const original = fs.readFileSync(model, "utf-8");
    try {
      await vscode.window.showTextDocument(vscode.Uri.file(model));
      const upstream = await until(
        { targets: [[ORDER_TOTALS, "total"]], upstreamExpansion: false },
        (lineage) => lineage.length > 0,
      );
      assert.deepStrictEqual(edges(upstream), [
        `model.lineage_probe.stg_orders amount ${ORDER_TOTALS} total Transformation`,
      ]);
      assertNoCliLineage();

      fs.writeFileSync(star, "select * from {{ ref('order_totals') }}\n");
      await save(
        "order_totals.sql",
        original.replace(
          "count(*) as n,",
          "count(*) as n, min(amount) as smallest,",
        ),
      );
      await vscode.window.showTextDocument(vscode.Uri.file(model));

      const added = await until(
        { targets: [[ORDER_TOTALS, "smallest"]], upstreamExpansion: true },
        (lineage) => lineage.length > 0,
      );
      assert.deepStrictEqual(edges(added), [
        `${ORDER_TOTALS} smallest ${TOTALS_STAR} smallest Unchanged`,
      ]);
      const child = await until(
        { targets: [[TOTALS_STAR, "smallest"]], upstreamExpansion: false },
        (lineage) => lineage.length > 0,
      );
      assert.deepStrictEqual(edges(child), [
        `${ORDER_TOTALS} smallest ${TOTALS_STAR} smallest Unchanged`,
      ]);
      assertNoCliLineage();
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      fs.writeFileSync(model, original);
      fs.rmSync(star, { force: true });
    }
  });
});
