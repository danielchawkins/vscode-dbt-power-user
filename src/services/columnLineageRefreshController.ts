import { commands, Disposable, TextDocument, window, workspace } from "vscode";
import { DBTProject } from "../dbt_client/dbtProject";
import { DBTProjectContainer } from "../dbt_client/dbtProjectContainer";
import { DBTTerminal } from "../dbt_integration/terminal";
import {
  CompileOutcome,
  describeCompileOutcome,
} from "../fusion/lineageDiagnostics";
import { resolveConfiguredStaticAnalysisMode } from "../fusion/staticAnalysisMode";
import { ProjectContext } from "../projects/projectContext";
import {
  ColumnLineageRefresh,
  RefreshableProject,
  RefreshOutcome,
} from "./columnLineageRefresh";

/**
 * Connects ColumnLineageRefresh to the editor: model saves, the refresh command, and a status-bar message
 * while a compile runs. Raw compile output goes to the terminal log.
 */
export class ColumnLineageRefreshController implements Disposable {
  private readonly disposables: Disposable[] = [];
  private readonly refresh: ColumnLineageRefresh;
  private readonly lastOutcome = new Map<string, CompileOutcome>();
  private progress: Disposable | undefined;
  private warning: Disposable | undefined;

  constructor(
    private readonly dbtProjectContainer: DBTProjectContainer,
    private readonly projectContext: ProjectContext,
    private readonly terminal: DBTTerminal,
  ) {
    this.refresh = new ColumnLineageRefresh({
      onStart: (_project, selectors) => {
        this.progress?.dispose();
        this.progress = window.setStatusBarMessage(
          `$(sync~spin) Computing column lineage${selectors.length ? ` for ${selectors.join(" ")}` : ""}…`,
        );
      },
      onEnd: (project, outcome) => {
        this.progress?.dispose();
        this.progress = undefined;
        this.report(project, outcome);
      },
    });
    this.disposables.push(
      workspace.onDidSaveTextDocument((document) => this.onSaved(document)),
      commands.registerCommand("fusionPowerUser.refreshColumnLineage", () =>
        this.refreshCurrentProject(),
      ),
    );
  }

  /** Full-project compile; the panel's "Compute column lineage" and the palette command. */
  async refreshCurrentProject(): Promise<RefreshOutcome | undefined> {
    const declared = await this.projectContext.requireForCommand();
    const project = declared
      ? this.dbtProjectContainer.findDBTProject(declared.root)
      : undefined;
    return project ? this.refresh.refreshProject(project) : undefined;
  }

  dispose(): void {
    this.progress?.dispose();
    this.warning?.dispose();
    this.refresh.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  private onSaved(document: TextDocument): void {
    if (document.uri.scheme !== "file" || !document.fileName.endsWith(".sql")) {
      return;
    }
    const project = this.dbtProjectContainer.findDBTProject(document.uri);
    const model = project
      ? modelForFile(project, document.uri.fsPath)
      : undefined;
    if (!project || !model) {
      return;
    }
    this.refresh.onModelSaved(
      project,
      model,
      resolveConfiguredStaticAnalysisMode(project.projectRoot),
    );
  }

  private report(project: RefreshableProject, outcome: RefreshOutcome): void {
    if (outcome.kind === "completed") {
      const { exitCode, stdout, stderr } = outcome.result;
      this.terminal.debug(
        "columnLineageRefresh",
        `compile ${outcome.selectors.join(" ") || "(project)"} exited ${exitCode}`,
        { project: project.projectRoot.fsPath, stdout, stderr },
      );
      const message = describeCompileOutcome(outcome.compile);
      this.lastOutcome.set(project.projectRoot.fsPath, outcome.compile);
      if (outcome.compile.kind !== "analyzed") {
        this.terminal.warn("columnLineageRefresh", message, false);
        this.warning?.dispose();
        this.warning = window.setStatusBarMessage(
          `$(warning) ${message}`,
          10_000,
        );
      }
    } else if (outcome.kind === "failed") {
      this.terminal.warn("columnLineageRefresh", outcome.message, false);
    }
  }

  /** The last refresh's outcome for the project at `root`, for the lineage panel. */
  lastCompileOutcome(root: string): CompileOutcome | undefined {
    return this.lastOutcome.get(root);
  }
}

/** The model whose SQL file is `fsPath`, by the manifest's absolute node path. */
export function modelForFile(
  project: Pick<DBTProject, "getMetadataSnapshot">,
  fsPath: string,
): string | undefined {
  const nodes = project.getMetadataSnapshot()?.nodeMetaMap.nodes();
  if (!nodes) {
    return undefined;
  }
  for (const node of nodes) {
    if (node.resource_type === "model" && node.path === fsPath) {
      return node.name;
    }
  }
  return undefined;
}
