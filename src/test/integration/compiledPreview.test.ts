import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { previewUriFor } from "../../projects/previewUri";
import { dbtInvocations, dbtInvocationsSince } from "./helpers/dbtSpy";

/**
 * Pins the compiled preview of a saved model against the pinned dbt: it shows the compiled text the language
 * server writes, with no Jinja left and no waiting or error text.
 */
const MODE = process.env.FPU_NATIVE_EDITOR_MODE;

suite("Compiled preview from the language server", function () {
  this.timeout(3 * 60_000);

  test("shows compiled SQL for a saved model", async function () {
    if (MODE !== "strict") {
      this.skip();
      return;
    }
    const projectDir = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const model = vscode.Uri.file(
      path.join(projectDir, "models", "cte_probe.sql"),
    );
    await vscode.window.showTextDocument(model);
    const spawned = dbtInvocations().length;
    const preview = previewUriFor(model);
    let text = "";
    for (let attempt = 0; attempt < 60; attempt += 1) {
      text = (await vscode.workspace.openTextDocument(preview)).getText();
      if (/select/i.test(text)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    assert.ok(/select/i.test(text), `preview was ${JSON.stringify(text)}`);
    assert.ok(!text.includes("{{"), "the preview still holds Jinja");
    assert.deepStrictEqual(
      dbtInvocationsSince(spawned, "compile"),
      [],
      "a saved model's preview must not spawn dbt compile",
    );
  });
});
