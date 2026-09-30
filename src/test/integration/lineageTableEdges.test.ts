import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { PARENT_TABLES_COMMAND } from "../../features/lineage/connectedColumnsCommand";

/**
 * Pins that the lineage panel's table edges follow manifest rebuilds: a model that adds a `ref` lists its
 * parent, and drops it once the `ref` is removed or the file is deleted. The service resolves the project
 * from the active editor.
 */
const MODE = process.env.FPU_NATIVE_EDITOR_MODE;
const ORDER_TOTALS = "model.lineage_probe.order_totals";
const EDGE_CHILD = "model.lineage_probe.edge_child";

suite("Lineage table edges follow the rebuilt manifest", function () {
  this.timeout(8 * 60_000);
  let projectDir = "";
  let child = "";

  suiteSetup(function () {
    projectDir = vscode.workspace.workspaceFolders![0].uri.fsPath;
    child = path.join(projectDir, "models", "edge_child.sql");
  });

  suiteTeardown(async function () {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    if (child) {
      fs.rmSync(child, { force: true });
    }
  });

  /** Polls `getParentTables` for `edge_child` until `done` holds, logging each distinct answer. */
  async function until(
    step: string,
    done: (tables: string[]) => boolean,
  ): Promise<string[]> {
    const start = Date.now();
    const deadline = start + 120_000;
    let last: string[] = [];
    let logged = "";
    while (Date.now() < deadline) {
      const body = await vscode.commands.executeCommand<
        { tables?: { table: string }[] } | undefined
      >(PARENT_TABLES_COMMAND, EDGE_CHILD);
      last = (body?.tables ?? []).map(({ table }) => table);
      const seen = JSON.stringify(last);
      if (seen !== logged) {
        logged = seen;
        console.log(`[${MODE}] ${step} +${Date.now() - start}ms: ${seen}`);
      }
      if (done(last)) {
        return last;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    assert.fail(
      `${step}: tables of ${EDGE_CHILD} stayed ${JSON.stringify(last)}`,
    );
  }

  test("adds and removes the child's edge as its ref changes", async function () {
    await vscode.window.showTextDocument(
      vscode.Uri.file(path.join(projectDir, "models", "order_totals.sql")),
    );
    fs.writeFileSync(child, "select * from {{ ref('order_totals') }}\n");
    await until("ref added", (tables) => tables.includes(ORDER_TOTALS));

    fs.writeFileSync(child, "select 1 as id\n");
    await until("ref removed", (tables) => !tables.includes(ORDER_TOTALS));

    fs.rmSync(child, { force: true });
    await until("file deleted", (tables) => tables.length === 0);
  });
});
