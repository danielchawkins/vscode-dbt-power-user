import { readFileSync } from "node:fs";
import * as path from "node:path";
import type { Disposable } from "vscode";
import {
  commands,
  Position,
  Range,
  Uri,
  window,
  workspace,
  WorkspaceEdit,
} from "vscode";
import type { Log } from "../../core/log";
import {
  DBT_PROJECT_FILE,
  dbtProjectFilePath,
  declaredProjectName,
  parseDbtProjectYaml,
} from "../../core/snapshot";
import type { ProjectConfigInsertion } from "../../fusion/projectConfigEdits";
import { planProjectConfigInsertion } from "../../fusion/projectConfigEdits";
import { notifyError } from "../../projects/output/notifications";
import type { CurrentProject } from "../../projects/project/currentProject";
import type { DeclaredProject } from "../../projects/registry/projectRegistry";
import { SCHEMA_ORIGIN_HOOK } from "../../projects/registry/schemaOrigin";
import { writeStrictStaticAnalysis } from "../../settings";
import type { StartupGate } from "../../startupGate";

const CONFIRM = "Add";

/**
 * Opt-ins a project makes in its own project file. Each adds one key after a modal that shows the exact
 * lines, never overwrites an existing value, and applies as a WorkspaceEdit so Undo reverts it. It also owns
 * the folder-scoped setting that makes a project strict without touching its project file.
 */
export class ProjectConfigCommands implements Disposable {
  private readonly disposables: Disposable[];
  private readonly startupGate: Pick<StartupGate, "whenSettled">;
  private readonly currentProject: CurrentProject;
  private readonly logFor: (root: Uri) => Log;

  constructor(
    startupGate: Pick<StartupGate, "whenSettled">,
    currentProject: CurrentProject,
    logFor: (root: Uri) => Log,
  ) {
    this.startupGate = startupGate;
    this.currentProject = currentProject;
    this.logFor = logFor;
    this.disposables = [
      commands.registerCommand(
        "fusionPowerUser.enableStrictAnalysis",
        (uri?: Uri) =>
          this.run(uri, (projectName) => ({
            // Project level: a model cannot be stricter than its parents (evidence README section 1).
            path: ["models", projectName, "+static_analysis"],
            value: "strict",
          })),
      ),
      commands.registerCommand(
        "fusionPowerUser.useStrictAnalysis",
        (root?: Uri) => this.useStrictAnalysis(root),
      ),
      commands.registerCommand(
        "fusionPowerUser.addSchemaOriginHook",
        (uri?: Uri) =>
          this.run(uri, () => ({
            path: ["sources", "+schema_origin"],
            value: SCHEMA_ORIGIN_HOOK,
          })),
      ),
    ];
  }

  /**
   * Sets `fusionPowerUser.staticAnalysis` to `strict` for the workspace folder holding the project, so every
   * Declared Project in that folder changes mode. The Fusion client pool restarts their language servers.
   */
  private async useStrictAnalysis(root: Uri | undefined): Promise<boolean> {
    await this.startupGate.whenSettled();
    const project = await this.currentProject.requireForCommand(root);
    if (!project) {
      return false;
    }
    try {
      await writeStrictStaticAnalysis(project.projectRoot);
      return true;
    } catch (error) {
      this.logFor(project.projectRoot).warn(
        "useStrictAnalysis",
        error instanceof Error ? error.message : String(error),
      );
      void notifyError(
        project,
        `Could not set fusionPowerUser.staticAnalysis for the folder ${project.declared.folder.name}`,
        error,
      );
      return false;
    }
  }

  private async run(
    uri: Uri | undefined,
    insertion: (projectName: string) => ProjectConfigInsertion,
  ): Promise<boolean> {
    await this.startupGate.whenSettled();
    const project = await this.currentProject.requireForCommand(uri);
    if (!project) {
      return false;
    }
    return applyProjectConfigInsertion(
      project.declared,
      insertion,
      this.logFor(project.projectRoot),
    );
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}

/**
 * Returns true when the edit was applied.
 * @internal
 */
export async function applyProjectConfigInsertion(
  project: DeclaredProject,
  insertion: (projectName: string) => ProjectConfigInsertion,
  terminal: Log,
): Promise<boolean> {
  const file = Uri.file(dbtProjectFilePath(project.root.fsPath));
  const open = workspace.textDocuments.find(
    (document) => document.uri.fsPath === file.fsPath,
  );
  const text = open?.getText() ?? readFileSync(file.fsPath, "utf8");
  const projectName =
    declaredProjectName(parseDbtProjectYaml(text).config) ?? project.name;
  const wanted = insertion(projectName);
  let plan;
  try {
    plan = planProjectConfigInsertion(text, wanted);
  } catch (error) {
    terminal.warn(
      "projectConfigEdit",
      error instanceof Error ? error.message : String(error),
    );
    void notifyError(
      project,
      `Could not edit ${path.basename(file.fsPath)}: it does not parse as YAML`,
    );
    return false;
  }
  if (plan.kind === "exists") {
    window.showInformationMessage(
      `${project.name}: ${wanted.path.join(".")} is already set to ${JSON.stringify(plan.current)}; nothing changed.`,
    );
    return false;
  }
  const answer = await window.showInformationMessage(
    `Add to ${project.name}/${DBT_PROJECT_FILE}?`,
    { modal: true, detail: plan.preview },
    CONFIRM,
  );
  if (answer !== CONFIRM) {
    return false;
  }
  const document = open ?? (await workspace.openTextDocument(file));
  const edit = new WorkspaceEdit();
  edit.replace(
    file,
    new Range(
      new Position(0, 0),
      document.lineAt(document.lineCount - 1).range.end,
    ),
    plan.text,
  );
  const applied = await workspace.applyEdit(edit);
  if (applied) {
    await document.save();
  }
  return applied;
}
