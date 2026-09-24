import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { checkFusionVersion } from "./helpers/testFixtures";
import { waitForExtensionActivation } from "./helpers/workspaceHelper";

/**
 * Drives each native Fusion LSP editor feature through the extension host, the way a user reaches it. Every
 * query polls because the server may still be indexing after activation. Scratch models are written into the
 * fixture copy and removed in teardown so other suites see the fixture unchanged.
 */

const TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function poll<T>(
  query: () => Thenable<T | undefined>,
  accept: (value: T) => boolean,
): Promise<T | undefined> {
  const deadline = Date.now() + TIMEOUT_MS;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await query();
    if (last !== undefined && accept(last)) {
      return last;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return last;
}

function hoverText(hovers: vscode.Hover[]): string {
  return hovers
    .flatMap((hover) => hover.contents)
    .map((content) =>
      typeof content === "string"
        ? content
        : "value" in content
          ? content.value
          : "",
    )
    .join("\n");
}

function locationUri(
  location: vscode.Location | vscode.LocationLink,
): vscode.Uri {
  return "targetUri" in location ? location.targetUri : location.uri;
}

suite("Fusion LSP editor features (extension)", function () {
  this.timeout(TIMEOUT_MS * 2);

  const fusionVerdict = checkFusionVersion();
  const scratchFiles: string[] = [];
  const restorers: (() => void)[] = [];
  let modelsDir = "";

  async function openScratch(
    name: string,
    text: string,
  ): Promise<vscode.TextDocument> {
    const file = path.join(modelsDir, name);
    fs.writeFileSync(file, text);
    scratchFiles.push(file);
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(file),
    );
    await vscode.window.showTextDocument(document);
    return document;
  }

  async function openModel(name: string): Promise<vscode.TextDocument> {
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(path.join(modelsDir, name)),
    );
    await vscode.window.showTextDocument(document);
    return document;
  }

  suiteSetup(async function () {
    if (process.env.FPU_SYMLINKED_WORKSPACE === "1") {
      this.skip();
      return;
    }
    if (fusionVerdict.kind !== "ok") {
      console.warn(
        "Skipping LSP editor feature tests: dbt Fusion 2.0.5+ required on PATH.",
      );
      this.skip();
      return;
    }
    await waitForExtensionActivation(TIMEOUT_MS);
    modelsDir = path.join(
      vscode.workspace.workspaceFolders![0].uri.fsPath,
      "models",
    );
  });

  suiteTeardown(async function () {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    for (const file of scratchFiles) {
      fs.rmSync(file, { force: true });
    }
    for (const restore of restorers) {
      restore();
    }
  });

  test("completion inside ref(' lists the project's models", async function () {
    const document = await openScratch(
      "scratch_completion.sql",
      "select * from {{ ref('') }}\n",
    );
    const position = document.positionAt(document.getText().indexOf("''") + 1);

    const list = await poll(
      () =>
        vscode.commands.executeCommand<vscode.CompletionList>(
          "vscode.executeCompletionItemProvider",
          document.uri,
          position,
          "'",
        ),
      (result) => result.items.some((item) => labelOf(item) === "base"),
    );

    const labels = list?.items.map(labelOf) ?? [];
    assert.ok(
      labels.includes("base"),
      `expected "base" in completions; got ${labels.slice(0, 20).join(", ")}`,
    );
  });

  test('hover on ref("base") describes the model', async function () {
    const document = await openModel("child.sql");
    const position = document.positionAt(
      document.getText().indexOf('"base"') + 1,
    );

    const hovers = await poll(
      () =>
        vscode.commands.executeCommand<vscode.Hover[]>(
          "vscode.executeHoverProvider",
          document.uri,
          position,
        ),
      (result) => result.length > 0,
    );

    assert.ok(hovers && hovers.length > 0, 'expected a hover for ref("base")');
    assert.ok(hoverText(hovers!).length > 0, "hover must carry content");
  });

  // Fusion 2.0.5 answers hover on any macro call, dotted or not, with null.
  test.skip("hover on a dotted package.macro returns documentation", async function () {
    const document = await openScratch(
      "scratch_hover_macro.sql",
      "select {{ dbt.current_timestamp() }} as ts\n",
    );
    const position = document.positionAt(
      document.getText().indexOf("current_timestamp") + 1,
    );

    const hovers = await poll(
      () =>
        vscode.commands.executeCommand<vscode.Hover[]>(
          "vscode.executeHoverProvider",
          document.uri,
          position,
        ),
      (result) => hoverText(result).length > 0,
    );

    assert.ok(
      hovers && hoverText(hovers).length > 0,
      "expected hover content for dbt.current_timestamp",
    );
  });

  test('definition on ref("base") resolves to base.sql', async function () {
    const document = await openModel("child.sql");
    const position = document.positionAt(
      document.getText().indexOf('"base"') + 1,
    );

    const locations = await poll(
      () =>
        vscode.commands.executeCommand<
          (vscode.Location | vscode.LocationLink)[]
        >("vscode.executeDefinitionProvider", document.uri, position),
      (result) => result.length > 0,
    );

    assert.ok(
      locations && locations.length > 0,
      'expected a definition for ref("base")',
    );
    assert.strictEqual(
      path.basename(locationUri(locations![0]).fsPath),
      "base.sql",
    );
  });

  test("definition on a macro call resolves to the macro file", async function () {
    const document = await openScratch(
      "scratch_macro.sql",
      "{{ example() }}\n",
    );
    const position = document.positionAt(
      document.getText().indexOf("example") + 1,
    );

    const locations = await poll(
      () =>
        vscode.commands.executeCommand<
          (vscode.Location | vscode.LocationLink)[]
        >("vscode.executeDefinitionProvider", document.uri, position),
      (result) => result.length > 0,
    );

    assert.ok(
      locations && locations.length > 0,
      "expected a definition for example()",
    );
    assert.strictEqual(
      path.basename(locationUri(locations![0]).fsPath),
      "example.sql",
    );
  });

  test("formatting an unformatted model returns edits", async function () {
    const document = await openScratch(
      "scratch_format.sql",
      "SELECT   1   AS   id\n",
    );

    const edits = await poll(
      () =>
        vscode.commands.executeCommand<vscode.TextEdit[]>(
          "vscode.executeFormatDocumentProvider",
          document.uri,
          { tabSize: 4, insertSpaces: true },
        ),
      (result) => result.length > 0,
    );

    assert.ok(edits && edits.length > 0, "expected formatting edits");
  });

  test("a broken ref() produces a diagnostic", async function () {
    const document = await openScratch(
      "scratch_broken_ref.sql",
      'select * from {{ ref("does_not_exist") }}\n',
    );
    await document.save();

    const diagnostics = await poll(
      async () => vscode.languages.getDiagnostics(document.uri),
      (result) => result.length > 0,
    );

    assert.ok(
      diagnostics && diagnostics.length > 0,
      "expected a diagnostic for the unresolved ref",
    );
  });

  test("source.fixAll.dbtLintFix is offered as a code action", async function () {
    const document = await openModel("base.sql");
    const original = document.getText();
    restorers.push(() => fs.writeFileSync(document.uri.fsPath, original));
    await vscode.window.activeTextEditor!.edit((edit) =>
      edit.replace(
        new vscode.Range(0, 0, document.lineCount, 0),
        "SELECT   1   AS   id\n",
      ),
    );
    await document.save();
    const range = new vscode.Range(0, 0, document.lineCount, 0);

    const actions = await poll(
      () =>
        vscode.commands.executeCommand<vscode.CodeAction[]>(
          "vscode.executeCodeActionProvider",
          document.uri,
          range,
          "source.fixAll",
        ),
      (result) => result.length > 0,
    );

    const diagnostics = vscode.languages
      .getDiagnostics(document.uri)
      .map((d) => `${d.source}:${d.code}:${d.message}`);
    const kinds = actions?.map((action) => action.kind?.value) ?? [];
    assert.ok(
      kinds.some((kind) => kind?.startsWith("source.fixAll")),
      `expected a source.fixAll action; got [${kinds.join(", ")}], diagnostics [${diagnostics.join(" | ")}]`,
    );
  });

  // Fusion 2.0.5 advertises renameProvider but answers prepareRename with MethodNotFound and rename with no edits.
  test.skip('rename on ref("base") returns a workspace edit', async function () {
    const document = await openModel("child.sql");
    const position = document.positionAt(
      document.getText().indexOf('"base"') + 1,
    );

    const edit = await poll(
      () =>
        vscode.commands.executeCommand<vscode.WorkspaceEdit>(
          "vscode.executeDocumentRenameProvider",
          document.uri,
          position,
          "base_renamed",
        ),
      (result) => result.size > 0,
    );

    assert.ok(edit && edit.size > 0, "expected a rename edit");
  });
});

function labelOf(item: vscode.CompletionItem): string {
  return typeof item.label === "string" ? item.label : item.label.label;
}
