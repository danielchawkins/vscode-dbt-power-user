import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";

/**
 * Pins the CTE lenses against the pinned dbt: every CTE of a saved model gets an Execute lens built from the
 * server's `dbt.previewCte` lens, and the first carries one Profile CTEs lens.
 */
const MODE = process.env.FPU_NATIVE_EDITOR_MODE;

suite("CTE lenses from the language server", function () {
  this.timeout(3 * 60_000);

  test("maps the server's CTE lenses to Execute and Profile actions", async function () {
    if (MODE !== "strict") {
      this.skip();
      return;
    }
    const projectDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    const model = vscode.Uri.file(
      path.join(projectDir, "models", "cte_probe.sql"),
    );
    await vscode.window.showTextDocument(model);
    let titles: string[] = [];
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const lenses =
        (await vscode.commands.executeCommand<vscode.CodeLens[]>(
          "vscode.executeCodeLensProvider",
          model,
        )) ?? [];
      titles = lenses.map((lens) => lens.command?.title ?? "");
      if (titles.some((title) => title.includes("Execute CTE"))) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    const executes = titles.filter((title) => title.includes("Execute CTE"));
    const profiles = titles.filter((title) => title.includes("Profile CTEs"));
    assert.ok(
      executes.length > 0,
      `lens titles were ${JSON.stringify(titles)}`,
    );
    assert.strictEqual(profiles.length, 1);
    assert.ok(!titles.includes("Preview CTE"), "the server lens leaked");
  });
});
