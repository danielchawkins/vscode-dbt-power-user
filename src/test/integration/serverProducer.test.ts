import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { PARENT_TABLES_COMMAND } from "../../features/lineage/connectedColumnsCommand";
import { dbtInvocations, dbtInvocationsSince } from "./helpers/dbtSpy";

/**
 * Pins the server producer: after a model gains a `ref` and is saved, the merged manifest lists the edge from the
 * server's `dbt.listNodes` within the server's compile time, without waiting for a `dbt parse`.
 */
const CHILD = "model.lineage_probe.server_producer_child";
const PARENT = "model.lineage_probe.order_totals";
const DEADLINE_MS = 30_000;

suite("server producer: the merged graph follows a saved ref", function () {
  this.timeout(8 * 60_000);
  let child = "";

  suiteSetup(function () {
    const projectDir = vscode.workspace.workspaceFolders![0].uri.fsPath;
    child = path.join(projectDir, "models", "server_producer_child.sql");
  });

  suiteTeardown(async function () {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    fs.rmSync(child, { force: true });
  });

  const parents = async (): Promise<string[]> => {
    const body = await vscode.commands.executeCommand<
      { tables?: { table: string }[] } | undefined
    >(PARENT_TABLES_COMMAND, CHILD);
    return (body?.tables ?? []).map(({ table }) => table);
  };

  test("lists the new edge soon after the save, before any dbt parse starts", async function () {
    const parentFile = path.join(path.dirname(child), "order_totals.sql");
    await vscode.window.showTextDocument(vscode.Uri.file(parentFile));
    const spawned = dbtInvocations().length;
    fs.writeFileSync(child, "select * from {{ ref('order_totals') }}\n");
    const start = Date.now();
    let seen: string[] = [];
    while (Date.now() - start < DEADLINE_MS) {
      seen = await parents();
      if (seen.includes(PARENT)) {
        // The parse starts after the watcher's debounce; the edge must already be visible by then.
        assert.deepStrictEqual(
          dbtInvocationsSince(spawned, "parse"),
          [],
          "the edge appeared only after a dbt parse was spawned",
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.fail(`parents of ${CHILD} stayed ${JSON.stringify(seen)}`);
  });
});
