import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { previewUriFor } from "../../projects/previewUri";
import { createEntry } from "../fixtures/runHistory";
import {
  dbtInvocations,
  dbtInvocationsSince,
  waitForDbtExits,
  waitForDbtQuiet,
} from "./helpers/dbtSpy";
import { getExtensionRoot } from "./helpers/testFixtures";
import {
  closeAllEditors,
  executeCommand,
  openDocument,
  waitForExtensionActivation,
} from "./helpers/workspaceHelper";
import {
  STUBBED_WINDOW_FUNCTIONS,
  type StubbedWindowFunction,
  type UiAnswers,
  type UiStubHandle,
  useUiStubs,
  withUiStubs,
} from "./uiStubs";

/** Scripts the dialogs its command opens, runs it, and asserts the effect it can observe. */
type Row = (ui: UiStubHandle) => Promise<void>;

interface PackageManifest {
  contributes: {
    commands: { command: string }[];
    menus: Record<
      string,
      { command?: string; submenu?: string; when?: string }[]
    >;
  };
}

/** Enough cancelled answers for any command that opens several dialogs in a row. */
const CANCEL_ANSWERS = 25;

/** How long a row or the suite waits for the dbt invocations it started to exit. */
const DBT_EXIT_TIMEOUT_MS = 120_000;

/** How long the spy log must stay free of dbt starts and exits before the suite treats dbt as idle. */
const DBT_QUIET_MS = 2_000;

const LENS_PROBE_YAML = [
  "version: 2",
  "models:",
  "  - name: child",
  "sources:",
  "  - name: raw",
  "    schema: main",
  "    tables:",
  "      - name: orders",
  "",
].join("\n");

function manifest(): PackageManifest {
  const file = path.join(getExtensionRoot(), "package.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as PackageManifest;
}

function projectRoot(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "No workspace folder is open");
  return folder.uri;
}

function modelPath(file: string): string {
  return path.join(projectRoot().fsPath, "models", file);
}

function projectFilePath(): string {
  return path.join(projectRoot().fsPath, "dbt_project.yml");
}

async function showModel(file: string): Promise<vscode.TextEditor> {
  const document = await openDocument(path.join("models", file));
  return vscode.window.showTextDocument(document);
}

function visibleFiles(): string[] {
  return vscode.window.visibleTextEditors.map((e) => e.document.uri.fsPath);
}

function previewVisible(model: vscode.Uri): boolean {
  const preview = previewUriFor(model).toString();
  return vscode.window.visibleTextEditors.some(
    (e) => e.document.uri.toString() === preview,
  );
}

async function waitFor(
  description: string,
  holds: () => boolean,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!holds()) {
    if (Date.now() >= deadline) {
      assert.fail(`timed out after ${timeoutMs}ms waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Runs `action`, then waits for dbt to be invoked with `subcommand` after it started, and for that run to exit. */
async function expectDbt(
  subcommand: string,
  action: () => Promise<unknown>,
): Promise<void> {
  const before = dbtInvocations().length;
  await action();
  await waitFor(
    `a dbt ${subcommand} invocation`,
    () => dbtInvocationsSince(before, subcommand).length > 0,
  );
  await waitForDbtToExit(before);
}

/** Waits until every dbt invocation started since `since` has exited; fails if one is still running at the bound. */
async function waitForDbtToExit(since: number): Promise<void> {
  const running = await waitForDbtExits(since, DBT_EXIT_TIMEOUT_MS);
  const subcommands = running.map((invocation) => invocation.subcommand);
  assert.deepStrictEqual(
    subcommands,
    [],
    `dbt still running ${DBT_EXIT_TIMEOUT_MS}ms after the wait began: ${subcommands.join("; ")}`,
  );
}

/**
 * Copies `target/` aside and returns a function that puts the copy back, removing whatever a command left there.
 * A `target/` that does not exist is restored as absent.
 */
function snapshotTarget(): () => void {
  const target = path.join(projectRoot().fsPath, "target");
  const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), "contributed-target-"));
  const copy = path.join(copyDir, "target");
  const existed = fs.existsSync(target);
  if (existed) {
    fs.cpSync(target, copy, { recursive: true, preserveTimestamps: true });
  }
  return () => {
    fs.rmSync(target, { recursive: true, force: true });
    if (existed) {
      fs.cpSync(copy, target, { recursive: true, preserveTimestamps: true });
    }
    fs.rmSync(copyDir, { recursive: true, force: true });
  };
}

function messagesOf(ui: UiStubHandle, name: StubbedWindowFunction): string[] {
  return (ui.calls[name] ?? []).map((args) => String(args[0]));
}

function expectConsumed(ui: UiStubHandle, name: StubbedWindowFunction): void {
  assert.strictEqual(
    ui.answers[name]?.length ?? 0,
    0,
    `scripted window.${name} answers were not all consumed`,
  );
}

/** Answers that dismiss every dialog, so a command runs as if the user cancelled each one. */
function cancelledAnswers(): UiAnswers {
  const answers: UiAnswers = {};
  for (const name of STUBBED_WINDOW_FUNCTIONS) {
    answers[name] = Array.from({ length: CANCEL_ANSWERS }, () => undefined);
  }
  return answers;
}

/** The picker item for the workspace's only project, shaped as `ProjectQuickPick` builds it. */
function projectPickItem() {
  const root = projectRoot();
  return { label: "single_project", description: root.fsPath, uri: root };
}

/**
 * Restores the workspace state a command can change: the project file, the files under `models/`, the user
 * file associations, and the folder's `projects` and static-analysis settings.
 */
async function preservingWorkspaceState(
  body: () => Promise<void>,
): Promise<void> {
  const root = projectRoot();
  const projectFile = projectFilePath();
  const projectText = fs.readFileSync(projectFile, "utf8");
  const modelsDir = path.join(root.fsPath, "models");
  const modelFiles = fs.readdirSync(modelsDir);
  const associations = vscode.workspace
    .getConfiguration()
    .inspect<Record<string, string>>("files.associations")?.globalValue;
  const folderSettings = vscode.workspace.getConfiguration(
    "fusionPowerUser",
    root,
  );
  const staticAnalysis =
    folderSettings.inspect<string>("staticAnalysis")?.workspaceFolderValue;
  const projects =
    folderSettings.inspect<unknown[]>("projects")?.workspaceFolderValue;
  try {
    await body();
  } finally {
    fs.writeFileSync(projectFile, projectText);
    for (const file of fs.readdirSync(modelsDir)) {
      if (!modelFiles.includes(file)) {
        fs.rmSync(path.join(modelsDir, file), { force: true });
      }
    }
    await vscode.workspace
      .getConfiguration()
      .update(
        "files.associations",
        associations,
        vscode.ConfigurationTarget.Global,
      );
    await folderSettings.update(
      "staticAnalysis",
      staticAnalysis,
      vscode.ConfigurationTarget.WorkspaceFolder,
    );
    await folderSettings.update(
      "projects",
      projects,
      vscode.ConfigurationTarget.WorkspaceFolder,
    );
  }
}

/** A model tree node as the model, run history and documentation views pass it to their commands. */
function treeNode() {
  return {
    label: "child",
    url: modelPath("child.sql"),
    entry: createEntry({
      command: "dbt run",
      args: ["child"],
      projectName: "single_project",
    }),
  };
}

/** Rows keyed by command id: each id in `contributes.commands` has one row, and each row one command. */
const rows: Record<string, Row> = {
  "fusionPowerUser.viewInDocEditor": async () => {
    await executeCommand("fusionPowerUser.viewInDocEditor");
  },
  "fusionPowerUser.runCurrentModel": async () => {
    await showModel("child.sql");
    await expectDbt("run", () =>
      executeCommand("fusionPowerUser.runCurrentModel"),
    );
  },
  "fusionPowerUser.rerunFromHistory": async () => {
    await expectDbt("run", () =>
      executeCommand("fusionPowerUser.rerunFromHistory", treeNode()),
    );
  },
  "fusionPowerUser.clearRunHistory": async (ui) => {
    ui.script("showWarningMessage", "Clear");
    await executeCommand("fusionPowerUser.clearRunHistory");
    assert.deepStrictEqual(messagesOf(ui, "showWarningMessage"), [
      "Clear all run history entries?",
    ]);
    expectConsumed(ui, "showWarningMessage");
  },
  "fusionPowerUser.profileCtes": async (ui) => {
    // The no-CTE path: the file has none, so the command reports that instead of profiling.
    await showModel("child.sql");
    ui.script("showInformationMessage", undefined);
    await executeCommand("fusionPowerUser.profileCtes");
    assert.deepStrictEqual(messagesOf(ui, "showInformationMessage"), [
      "No CTEs found in this file to profile. Save the file first.",
    ]);
    expectConsumed(ui, "showInformationMessage");
  },
  "fusionPowerUser.cancelCteProfiling": async () => {
    await executeCommand("fusionPowerUser.cancelCteProfiling");
  },
  "fusionPowerUser.clearProfileResults": async () => {
    await executeCommand("fusionPowerUser.clearProfileResults");
  },
  "fusionPowerUser.toggleProfileDecorations": async () => {
    await executeCommand("fusionPowerUser.toggleProfileDecorations");
  },
  "fusionPowerUser.validateProject": async (ui) => {
    ui.script("showQuickPick", projectPickItem());
    ui.script("showInformationMessage", "Yes");
    await expectDbt("debug", () =>
      executeCommand("fusionPowerUser.validateProject"),
    );
    expectConsumed(ui, "showInformationMessage");
  },
  "fusionPowerUser.installDeps": async (ui) => {
    // Runs after validateProject, which leaves the picked project in workspace state, so no picker opens.
    ui.script("showInformationMessage", "Yes");
    await expectDbt("deps", () =>
      executeCommand("fusionPowerUser.installDeps"),
    );
    expectConsumed(ui, "showInformationMessage");
  },
  "fusionPowerUser.useStrictAnalysis": async () => {
    await preservingWorkspaceState(async () => {
      await executeCommand("fusionPowerUser.useStrictAnalysis", projectRoot());
      assert.strictEqual(
        vscode.workspace
          .getConfiguration("fusionPowerUser", projectRoot())
          .get("staticAnalysis"),
        "strict",
      );
    });
  },
  "fusionPowerUser.enableStrictAnalysis": async (ui) => {
    await preservingWorkspaceState(async () => {
      ui.script("showInformationMessage", "Add");
      await executeCommand(
        "fusionPowerUser.enableStrictAnalysis",
        projectRoot(),
      );
      expectConsumed(ui, "showInformationMessage");
      assert.match(
        fs.readFileSync(projectFilePath(), "utf8"),
        /\+static_analysis: strict/,
      );
    });
  },
  "fusionPowerUser.addSchemaOriginHook": async (ui) => {
    await preservingWorkspaceState(async () => {
      ui.script("showInformationMessage", "Add");
      await executeCommand(
        "fusionPowerUser.addSchemaOriginHook",
        projectRoot(),
      );
      expectConsumed(ui, "showInformationMessage");
      assert.match(fs.readFileSync(projectFilePath(), "utf8"), /schema_origin/);
    });
  },
  "fusionPowerUser.compileCurrentModel": async () => {
    await showModel("child.sql");
    await expectDbt("compile", () =>
      executeCommand("fusionPowerUser.compileCurrentModel"),
    );
  },
  "fusionPowerUser.sqlPreview": async () => {
    const model = await showModel("child.sql");
    const before = dbtInvocations().length;
    await executeCommand("fusionPowerUser.sqlPreview");
    await waitFor("the compiled preview beside the model", () =>
      previewVisible(model.document.uri),
    );
    await waitForDbtToExit(before);
  },
  "fusionPowerUser.runTest": async () => {
    await expectDbt("test", () =>
      executeCommand("fusionPowerUser.runTest", {
        label: "not_null_child_id.abc123",
        url: modelPath("child.sql"),
      }),
    );
  },
  "fusionPowerUser.testCurrentModel": async () => {
    await showModel("child.sql");
    await expectDbt("test", () =>
      executeCommand("fusionPowerUser.testCurrentModel"),
    );
  },
  "fusionPowerUser.runChildrenModels": async () => {
    await showModel("child.sql");
    await expectDbt("run", () =>
      executeCommand("fusionPowerUser.runChildrenModels"),
    );
  },
  "fusionPowerUser.runParentModels": async () => {
    await showModel("child.sql");
    await expectDbt("run", () =>
      executeCommand("fusionPowerUser.runParentModels"),
    );
  },
  "fusionPowerUser.copyModelName": async () => {
    await executeCommand("fusionPowerUser.copyModelName", treeNode());
    assert.strictEqual(await vscode.env.clipboard.readText(), "child");
  },
  "fusionPowerUser.showRunSQL": async () => {
    // `showRunSQL` opens an existing compiled file under `target/run`, so the row writes one and removes it.
    const compiled = path.join(
      projectRoot().fsPath,
      "target",
      "run",
      "single_project",
      "models",
      "child.sql",
    );
    fs.mkdirSync(path.dirname(compiled), { recursive: true });
    fs.writeFileSync(compiled, "select 1\n");
    try {
      await showModel("child.sql");
      await executeCommand("fusionPowerUser.showRunSQL");
      await waitFor("the compiled run SQL open", () =>
        visibleFiles().includes(compiled),
      );
    } finally {
      fs.rmSync(compiled, { force: true });
    }
  },
  "fusionPowerUser.generateSchemaYML": async () => {
    await preservingWorkspaceState(async () => {
      await showModel("with_ctes.sql");
      await executeCommand("fusionPowerUser.generateSchemaYML");
      const schema = modelPath("with_ctes_schema.yml");
      await waitFor("the generated schema YAML open", () =>
        visibleFiles().includes(schema),
      );
    });
  },
  "fusionPowerUser.goToDocumentationEditor": async () => {
    await executeCommand("fusionPowerUser.goToDocumentationEditor");
  },
  "fusionPowerUser.showCompiledSQL": async () => {
    const model = await showModel("child.sql");
    const before = dbtInvocations().length;
    await executeCommand("fusionPowerUser.showCompiledSQL");
    await waitFor("the compiled preview beside the model", () =>
      previewVisible(model.document.uri),
    );
    await waitForDbtToExit(before);
  },
  // The results view is a view in the bottom panel, not an editor tab, so no tab group lists it. Its `dbt show`
  // runs only after the view's focus command, so seeing that run shows the view opened.
  "fusionPowerUser.executeSQL": async () => {
    await showModel("with_ctes.sql");
    await expectDbt("show", () => executeCommand("fusionPowerUser.executeSQL"));
  },
  "fusionPowerUser.buildCurrentModel": async () => {
    await showModel("child.sql");
    await expectDbt("build", () =>
      executeCommand("fusionPowerUser.buildCurrentModel"),
    );
  },
  "fusionPowerUser.buildChildrenModels": async () => {
    await showModel("child.sql");
    await expectDbt("build", () =>
      executeCommand("fusionPowerUser.buildChildrenModels"),
    );
  },
  "fusionPowerUser.buildParentModels": async () => {
    await showModel("child.sql");
    await expectDbt("build", () =>
      executeCommand("fusionPowerUser.buildParentModels"),
    );
  },
  "fusionPowerUser.buildChildrenParentModels": async () => {
    await showModel("child.sql");
    await expectDbt("build", () =>
      executeCommand("fusionPowerUser.buildChildrenParentModels"),
    );
  },
  "fusionPowerUser.buildCurrentProject": async () => {
    await showModel("child.sql");
    await expectDbt("build", () =>
      executeCommand("fusionPowerUser.buildCurrentProject"),
    );
  },
  "fusionPowerUser.cleanCurrentProject": async () => {
    await showModel("child.sql");
    // `dbt clean` deletes target/, which later suites read, so the row puts back the target/ it started with.
    const restoreTarget = snapshotTarget();
    try {
      await expectDbt("clean", () =>
        executeCommand("fusionPowerUser.cleanCurrentProject"),
      );
    } finally {
      restoreTarget();
    }
  },
  "fusionPowerUser.diagnostics": async () => {
    await executeCommand("fusionPowerUser.diagnostics");
  },
  "fusionPowerUser.configureFileAssociations": async (ui) => {
    await preservingWorkspaceState(async () => {
      ui.script("showInformationMessage", undefined);
      await executeCommand("fusionPowerUser.configureFileAssociations");
      assert.match(
        messagesOf(ui, "showInformationMessage")[0] ?? "",
        /dbt file associations/,
      );
      expectConsumed(ui, "showInformationMessage");
      const associations =
        vscode.workspace
          .getConfiguration()
          .get<Record<string, string>>("files.associations") ?? {};
      assert.ok(
        Object.values(associations).includes("jinja-sql"),
        "files.associations holds no jinja-sql template glob",
      );
    });
  },
  "fusionPowerUser.applyDeferConfig": async (ui) => {
    ui.script("showInformationMessage", undefined);
    await executeCommand("fusionPowerUser.applyDeferConfig");
    assert.deepStrictEqual(messagesOf(ui, "showInformationMessage"), [
      "Applied defer configuration",
    ]);
    expectConsumed(ui, "showInformationMessage");
  },
  // Invoked from the status item, which is why the palette hides it; this row is its only test.
  "fusionPowerUser.addToProjects": async () => {
    await preservingWorkspaceState(async () => {
      const folder = projectRoot();
      const settings = vscode.workspace.getConfiguration(
        "fusionPowerUser",
        folder,
      );
      await settings.update(
        "projects",
        ["models"],
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      // With `models` as the only entry the folder root is no longer declared by configuration. Opening a model
      // then declares that root from the opened file, which is the project the status item offers to add.
      await showModel("child.sql");
      await executeCommand("fusionPowerUser.addToProjects", folder);
      await waitFor("the folder's projects to hold the root", () =>
        sameEntries(
          settings.inspect<unknown[]>("projects")?.workspaceFolderValue,
          ["models", "."],
        ),
      );
    });
  },
};

/** Whether `actual` is an array holding exactly the entries of `expected`, in order. */
function sameEntries(actual: unknown, expected: unknown[]): boolean {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((entry, index) => entry === expected[index])
  );
}

suite("Contributed commands", function () {
  this.timeout(3 * 60_000);

  const ui = useUiStubs();
  // Every dbt invocation from here on is this suite's, including the one activation makes.
  let dbtMark = 0;
  let restoreTarget: (() => void) | undefined;

  suiteSetup(async function () {
    this.timeout(DBT_EXIT_TIMEOUT_MS + 60_000);
    dbtMark = dbtInvocations().length;
    await waitForExtensionActivation();
    // The copy must hold activation's finished output, or restoring it would undo the parse.
    await waitForDbtToExit(dbtMark);
    restoreTarget = snapshotTarget();
  });

  suiteTeardown(async function () {
    this.timeout(DBT_EXIT_TIMEOUT_MS + 30_000);
    try {
      // The last row rewrites dbt_project.yml, and the manifest trigger rebuilds through dbt about 500ms later. Wait
      // until dbt has been quiet for a while, so no rebuild starts after target/ is restored.
      const running = await waitForDbtQuiet(
        dbtMark,
        DBT_QUIET_MS,
        DBT_EXIT_TIMEOUT_MS,
      );
      const subcommands = running.map((invocation) => invocation.subcommand);
      assert.deepStrictEqual(
        subcommands,
        [],
        `dbt still running ${DBT_EXIT_TIMEOUT_MS}ms after the suite ended: ${subcommands.join("; ")}`,
      );
    } finally {
      // Later suites expect the target/ this suite started with, not the output of its dbt runs.
      restoreTarget?.();
    }
  });

  test("every contributed command has a row and every row names a contributed command", () => {
    const contributed = manifest().contributes.commands.map((c) => c.command);
    const missing = contributed.filter((id) => !(id in rows));
    const extra = Object.keys(rows).filter((id) => !contributed.includes(id));
    assert.deepStrictEqual({ missing, extra }, { missing: [], extra: [] });
  });

  for (const [id, row] of Object.entries(rows)) {
    test(id, async () => {
      await closeAllEditors();
      try {
        await row(ui);
      } finally {
        await closeAllEditors();
      }
    });
  }

  test("every contributes.menus command runs with its location's argument shape", async function () {
    this.timeout(15 * 60_000);
    const menus = manifest().contributes.menus;
    const palette = menus.commandPalette ?? [];
    const reachedFromTree = new Set(
      (menus["view/item/context"] ?? []).map((item) => item.command),
    );
    // Entries hidden from the palette run through their tree item menu, or through a row when a menu does not
    // reach them (addToProjects is run from the status item).
    for (const item of palette) {
      if (item.when === "false" && item.command) {
        assert.ok(
          reachedFromTree.has(item.command) || item.command in rows,
          `${item.command} is hidden from the palette and no tree menu or row runs it`,
        );
      }
    }
    const shapeOf = (location: string): "editor" | "none" | "tree" => {
      if (location.startsWith("view/item/")) {
        return "tree";
      }
      return location === "view/title" ? "none" : "editor";
    };
    const runs = new Map<string, { command: string; shape: string }>();
    for (const [location, items] of Object.entries(menus)) {
      if (location === "commandPalette" || location === "editor/context") {
        continue;
      }
      for (const item of items) {
        if (item.command) {
          const shape = shapeOf(location);
          runs.set(`${item.command} ${shape}`, {
            command: item.command,
            shape,
          });
        }
      }
    }
    await preservingWorkspaceState(async () => {
      await showModel("child.sql");
      const before = dbtInvocations().length;
      for (const { command, shape } of runs.values()) {
        const args =
          shape === "editor"
            ? [vscode.Uri.file(modelPath("child.sql"))]
            : shape === "tree"
              ? [treeNode()]
              : [];
        await withUiStubs(cancelledAnswers(), () =>
          executeCommand(command, ...args),
        );
      }
      await waitForDbtToExit(before);
    });
  });

  test("every code lens command runs with its arguments", async function () {
    this.timeout(15 * 60_000);
    await preservingWorkspaceState(async () => {
      const before = dbtInvocations().length;
      const probe = modelPath("lens_probe.yml");
      fs.writeFileSync(probe, LENS_PROBE_YAML);
      const untitled = await vscode.workspace.openTextDocument({
        language: "jinja-sql",
        content: "select 1\n",
      });
      try {
        // The integration runner removes broken_ref.sql from this workspace, so it is not a lens source here.
        const documents = [
          vscode.Uri.file(modelPath("child.sql")),
          vscode.Uri.file(modelPath("with_ctes.sql")),
          vscode.Uri.file(probe),
          untitled.uri,
        ];
        const lenses: vscode.CodeLens[] = [];
        for (const uri of documents) {
          // The lens lookup throws "Illegal argument" for a document with no loaded text model, and a file the
          // test only wrote to disk has none; opening it first loads one.
          await vscode.workspace.openTextDocument(uri);
          const found = await vscode.commands.executeCommand<vscode.CodeLens[]>(
            "vscode.executeCodeLensProvider",
            uri,
          );
          lenses.push(...(found ?? []));
        }
        const lensCommands = lenses.flatMap((lens) =>
          lens.command ? [lens.command] : [],
        );
        const ids = new Set(lensCommands.map((c) => c.command));
        for (const expected of [
          "fusionPowerUser.yamlRunModel",
          "fusionPowerUser.yamlTestModel",
          "fusionPowerUser.pickProject",
        ]) {
          assert.ok(ids.has(expected), `no code lens runs ${expected}`);
        }
        for (const lens of lensCommands) {
          await withUiStubs(cancelledAnswers(), () =>
            executeCommand(lens.command, ...(lens.arguments ?? [])),
          );
        }
      } finally {
        await closeAllEditors();
      }
      await waitForDbtToExit(before);
    });
  });
});
