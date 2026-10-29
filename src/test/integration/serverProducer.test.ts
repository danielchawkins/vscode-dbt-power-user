import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { PARENT_TABLES_COMMAND } from "../../features/lineage/connectedColumnsCommand";
import { pollUntil } from "../async";
import { holdDbt } from "./helpers/dbtSpy";
import { showLineageView } from "./helpers/workspaceHelper";

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

  suiteSetup(async function () {
    await showLineageView();
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
    // Every parse waits at its start, so the edge can come only from the server's listNodes.
    const release = holdDbt("parse");
    try {
      fs.writeFileSync(child, "select * from {{ ref('order_totals') }}\n");
      await pollUntil(parents, (seen) => seen.includes(PARENT), {
        timeoutMs: DEADLINE_MS,
        intervalMs: 100,
        describe: `parents of ${CHILD} to include ${PARENT}`,
      });
    } finally {
      release();
    }
  });
});
