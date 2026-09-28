import * as assert from "assert";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  buildLineageQuery,
  classifyLineageRead,
  toPanelLineage,
} from "../../fusion/columnLineage";

/**
 * Pins the column-lineage read against the dbt binary the launch uses: a strict info-schema compile of the
 * native-editor fixture, then the exact argv `showColumnLineage` sends, parsed by the extension's reader. A
 * Fusion release that renames the view's columns or changes `--quiet` framing fails here. Runs only in the
 * `strict` native-editor launch, whose fixture copy has sources set up and local schema origin in the env.
 */
const MODE = process.env.FPU_NATIVE_EDITOR_MODE;

suite("Column lineage read through the pinned dbt", function () {
  this.timeout(5 * 60_000);
  let projectDir = "";
  let dbtPath = "dbt";

  suiteSetup(function () {
    if (MODE !== "strict") {
      this.skip();
      return;
    }
    projectDir = vscode.workspace.workspaceFolders![0].uri.fsPath;
    // The same executable the extension launches; the runner sets it from FPU_INTEGRATION_DBT_PATH.
    dbtPath =
      vscode.workspace
        .getConfiguration("fusionPowerUser")
        .get<string>("dbtPath") || "dbt";
  });

  const dbt = (args: string[]) =>
    spawnSync(dbtPath, [...args, "--profiles-dir", projectDir], {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 120_000,
      env: { ...process.env, FUSION_POWER_USER_SCHEMA_ORIGIN: "local" },
    });

  test("reads order_totals.total upstream edges after a strict compile", function () {
    const compile = dbt([
      "compile",
      "--static-analysis",
      "strict",
      "--generate-info-schema",
    ]);
    assert.strictEqual(
      compile.status,
      0,
      `${compile.stdout}\n${compile.stderr}`,
    );

    const show = dbt([
      "show",
      "--inline",
      buildLineageQuery(["model.lineage_probe.order_totals"], "upstream"),
      "--output",
      "json",
      "--limit",
      "-1",
      "--quiet",
    ]);
    assert.strictEqual(show.stderr, "", "--quiet read wrote to stderr");
    const read = classifyLineageRead({
      exitCode: show.status,
      stdout: show.stdout,
      stderr: show.stderr,
    });
    assert.strictEqual(read.kind, "edges", JSON.stringify(read));
    if (read.kind !== "edges") {
      return;
    }

    const total = toPanelLineage(
      read.edges.filter((edge) => edge.child.column === "total"),
      (uniqueId) => uniqueId,
    );
    assert.deepStrictEqual(
      total.map(({ source, viewsType }) => [...source, viewsType]).sort(),
      [
        ["model.lineage_probe.stg_orders", "amount", "Transformation"],
        ["model.lineage_probe.stg_orders", "customer_id", "Non select"],
      ],
    );
  });

  test("saving a model refreshes its lineage through the extension with no warehouse file", async function () {
    const warehouse = path.join(projectDir, "probe.duckdb");
    const moved = `${warehouse}.moved`;
    const model = vscode.Uri.file(
      path.join(projectDir, "models", "order_totals.sql"),
    );
    const original = fs.readFileSync(model.fsPath, "utf-8");
    fs.renameSync(warehouse, moved);
    try {
      const document = await vscode.workspace.openTextDocument(model);
      const editor = await vscode.window.showTextDocument(document);
      await editor.edit((edit) =>
        edit.replace(
          new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length),
          ),
          original.replace(
            "count(*) as n,",
            "count(*) as n, min(amount) as smallest,",
          ),
        ),
      );
      await document.save();

      const deadline = Date.now() + 90_000;
      let columns: string[] = [];
      while (Date.now() < deadline) {
        const show = dbt([
          "show",
          "--inline",
          buildLineageQuery(["model.lineage_probe.order_totals"], "upstream"),
          "--output",
          "json",
          "--limit",
          "-1",
          "--quiet",
        ]);
        const read = classifyLineageRead({
          exitCode: show.status,
          stdout: show.stdout,
          stderr: show.stderr,
        });
        columns =
          read.kind === "edges"
            ? read.edges.map((edge) => edge.child.column)
            : [];
        if (columns.includes("smallest")) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      assert.ok(
        columns.includes("smallest"),
        `save did not refresh lineage; columns: ${columns.join(", ")}`,
      );
      assert.ok(
        !fs.existsSync(warehouse),
        "the refresh recreated the warehouse file",
      );
    } finally {
      fs.writeFileSync(model.fsPath, original);
      fs.renameSync(moved, warehouse);
    }
  });

  test("a remote-origin project compile with a dropped source reports skipped with dbt1014", async function () {
    const projectFile = path.join(projectDir, "dbt_project.yml");
    const original = fs.readFileSync(projectFile, "utf-8");
    // Drop first: editing dbt_project.yml starts a reparse that holds the DuckDB file lock.
    const drop = dbt(["run-operation", "drop_contacts"]);
    assert.strictEqual(drop.status, 0, `${drop.stdout}\n${drop.stderr}`);
    // Remote origin whatever env the extension passes, so the missing table must be downloaded.
    fs.writeFileSync(
      projectFile,
      original.replace(
        /sources:\n\s+\+schema_origin:[^\n]*\n/,
        "sources:\n  +schema_origin: remote\n",
      ),
    );
    try {
      // The reparse may still hold the lock; a locked run fails with dbt1308, so retry until one classifies.
      const deadline = Date.now() + 60_000;
      let outcome:
        | { kind: string; compile?: { kind: string; models?: string[] } }
        | undefined;
      do {
        outcome = await vscode.commands.executeCommand(
          "fusionPowerUser.refreshColumnLineage",
        );
        const lockHeld =
          outcome?.kind === "completed" &&
          outcome.compile?.kind === "failed" &&
          JSON.stringify(outcome.compile).includes("dbt1308");
        if (!lockHeld) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      } while (Date.now() < deadline);
      assert.strictEqual(outcome?.kind, "completed", JSON.stringify(outcome));
      assert.deepStrictEqual(outcome?.compile, {
        kind: "skipped",
        models: ["model.lineage_probe.hard"],
      });
    } finally {
      fs.writeFileSync(projectFile, original);
    }
  });
});
