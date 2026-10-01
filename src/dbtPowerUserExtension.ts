import { commands, Disposable, extensions, window, workspace } from "vscode";
import { registerRuntimeTimings } from "./benchmark/runtimeTimings";
import { DBTTerminal } from "./dbt_integration";
import { CodeLensProviders } from "./features/codeLenses";
import { VSCodeCommands } from "./features/commands";
import { ContentProviders } from "./features/contentProviders";
import { registerConnectedColumnsCommand } from "./features/lineage/connectedColumnsCommand";
import { DbtLineageService } from "./features/lineage/dbtLineageService";
import { WebviewViewProviders } from "./features/panels";
import { DbtPowerUserActionsCenter } from "./features/projectPicker/actionsCenter";
import { FileAssociationsCommand } from "./features/projectSetup/fileAssociations";
import { ProjectConfigCommands } from "./features/projectSetup/projectConfigCommands";
import { StatusBars } from "./features/statusBars";
import { TreeviewProviders } from "./features/treeViews";
import { registerFusionClientDiagnostics } from "./fusion/fusionClientDiagnostics";
import { FusionClientPool } from "./fusion/fusionClientPool";
import { FusionStatus } from "./fusion/fusionStatus";
import { CurrentProject } from "./projects/currentProject";
import { ProjectRegistry } from "./projects/projectRegistry";
import { Projects } from "./projects/projects";
import { RunHistoryService } from "./projects/runHistoryService";
import { SharedStateService } from "./projects/sharedStateService";
import { readSetting } from "./settings";
import { StartupGate } from "./startupGate";

enum PromptAnswer {
  YES = "Yes",
  NO = "No",
}

const UPSTREAM_EXTENSION_ID = "innoverio.vscode-dbt-power-user";
const UNINSTALL_POWER_USER = "Uninstall Power User";

export class DBTPowerUserExtension implements Disposable {
  static DBT_SQL_SELECTOR = [
    { language: "jinja-sql", scheme: "file" },
    { language: "sql", scheme: "file" },
    { language: "jinja-sql", scheme: "untitled" },
  ];
  static DBT_YAML_SELECTOR = [{ language: "yaml", scheme: "file" }];
  static DBT_YAML_SQL_SELECTOR = [
    { language: "jinja-sql", scheme: "file" },
    { language: "sql", scheme: "file" },
    { language: "yaml", scheme: "file" },
  ];

  private disposables: Disposable[] = [];
  private disposed = false;

  constructor(
    private projects: Projects,
    private webviewViewProviders: WebviewViewProviders,
    private vscodeCommands: VSCodeCommands,
    private treeviewProviders: TreeviewProviders,
    private contentProviders: ContentProviders,
    private codeLensProviders: CodeLensProviders,
    private statusBars: StatusBars,
    private puStatusBars: DbtPowerUserActionsCenter,
    private dbtTerminal: DBTTerminal,
    private projectRegistry: ProjectRegistry,
    private currentProject: CurrentProject,
    private fusionClientPool: FusionClientPool,
    private fusionStatus: FusionStatus,
    private projectConfigCommands: ProjectConfigCommands,
    private fileAssociationsCommand: FileAssociationsCommand,
    private startupGate: StartupGate,
    private dbtLineageService: DbtLineageService,
    /** Disposed after every other collaborator. */
    private sharedState: SharedStateService,
    /** Disposed after every other collaborator except `sharedState`. */
    private runHistoryService: RunHistoryService,
    private dbtTaskProvider: Disposable,
  ) {
    this.disposables.push(
      this.sharedState,
      this.runHistoryService,
      this.dbtTerminal,
      this.projects,
      this.dbtTaskProvider,
      this.webviewViewProviders,
      this.treeviewProviders,
      this.contentProviders,
      this.codeLensProviders,
      this.vscodeCommands,
      this.statusBars,
      this.puStatusBars,
      this.projectRegistry,
      this.currentProject,
      this.fusionClientPool,
      this.fusionStatus,
      this.projectConfigCommands,
      this.fileAssociationsCommand,
    );
  }

  dispose() {
    this.disposed = true;
    this.startupGate.settle();
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private own(disposable: Disposable | undefined): void {
    if (disposable) {
      this.disposables.push(disposable);
    }
  }

  async deactivate(): Promise<void> {
    await this.fusionClientPool.stop();
    this.dispose();
  }

  /**
   * Registers commands synchronously, then starts projects. The returned promise settles once
   * startup finishes or stops; it never rejects.
   */
  activate(): Promise<void> {
    this.own(registerRuntimeTimings());
    this.own(
      registerFusionClientDiagnostics(
        this.projectRegistry,
        this.fusionClientPool,
      ),
    );
    this.own(registerConnectedColumnsCommand(this.dbtLineageService));
    return this.start();
  }

  private async start(): Promise<void> {
    try {
      if (extensions.getExtension(UPSTREAM_EXTENSION_ID)) {
        const action = await window.showErrorMessage(
          "Fusion Power User cannot start while dbt Power User is installed.",
          { modal: true },
          UNINSTALL_POWER_USER,
        );
        if (!this.disposed && action === UNINSTALL_POWER_USER) {
          await commands.executeCommand(
            "workbench.extensions.uninstallExtension",
            UPSTREAM_EXTENSION_ID,
          );
          await commands.executeCommand("workbench.action.reloadWindow");
        }
        return;
      }

      const folders = workspace.workspaceFolders ?? [];
      if (
        folders.length > 0 &&
        folders.every((folder) => !readSetting("enabled", folder.uri))
      ) {
        return;
      }

      await this.projectRegistry.initialize();
      if (this.disposed) {
        return;
      }
      this.fusionClientPool.initialize();
      this.fusionStatus.initialize();
      await this.projects.initialize();
      if (this.disposed) {
        return;
      }
      await this.statusBars.initialize();
    } catch (error) {
      this.dbtTerminal.error(
        "extensionActivationError",
        "Unable to activate Fusion Power User",
        error,
      );
    } finally {
      this.startupGate.settle();
    }
  }
}
