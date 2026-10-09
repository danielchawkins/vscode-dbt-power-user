import { commands, Disposable, extensions, window, workspace } from "vscode";
import { registerRuntimeTimings } from "./benchmark/runtimeTimings";
import type { Log } from "./core/log";
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
import { CurrentProject } from "./projects/currentProject";
import { registerFusionClientDiagnostics } from "./projects/fusionClientDiagnostics";
import { FusionClientPool } from "./projects/fusionClientPool";
import { FusionStatus } from "./projects/fusionStatus";
import { ProjectEnvironments } from "./projects/projectEnvironments";
import { ProjectRegistry } from "./projects/projectRegistry";
import { Projects } from "./projects/projects";
import { RunHistoryService } from "./projects/runHistoryService";
import { SharedStateService } from "./projects/sharedStateService";
import { readSetting } from "./settings";
import { StartupGate } from "./startupGate";

const UPSTREAM_EXTENSION_ID = "innoverio.vscode-dbt-power-user";
const UNINSTALL_POWER_USER = "Uninstall Power User";

export class DBTPowerUserExtension implements Disposable {
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
    private dbtTerminal: Log,
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
    private projectEnvironments: ProjectEnvironments,
  ) {
    this.disposables.push(
      this.sharedState,
      this.runHistoryService,
      this.dbtTerminal,
      this.projects,
      this.dbtTaskProvider,
      this.projectEnvironments,
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
        // A modal with its own action, not a project error.
        // eslint-disable-next-line no-restricted-properties
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

      await this.projectRegistry.initialize();
      if (this.disposed) {
        return;
      }
      if (
        this.allFoldersDisabled() &&
        this.projectRegistry.projects.length === 0
      ) {
        this.startWhenFirstProject();
        return;
      }
      await this.startServices();
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

  private allFoldersDisabled(): boolean {
    const folders = workspace.workspaceFolders ?? [];
    return (
      folders.length > 0 &&
      folders.every((folder) => !readSetting("enabled", folder.uri))
    );
  }

  /** Keeps everything but the registry idle until a folder is enabled and registers a project. */
  private startWhenFirstProject(): void {
    const subscription = this.projectRegistry.onDidChangeProjects(() => {
      if (this.disposed || this.projectRegistry.projects.length === 0) {
        return;
      }
      subscription.dispose();
      this.startServices().catch((error) =>
        this.dbtTerminal.error(
          "extensionActivationError",
          "Unable to activate Fusion Power User",
          error,
        ),
      );
    });
    this.own(subscription);
  }

  private async startServices(): Promise<void> {
    this.fusionClientPool.initialize();
    this.fusionStatus.initialize();
    await this.projects.initialize();
    if (this.disposed) {
      return;
    }
    this.statusBars.initialize();
  }
}
