import type { Disposable } from "vscode";
import { commands, extensions, window, workspace } from "vscode";
import { registerRuntimeTimings } from "./benchmark/runtimeTimings";
import type { Log } from "./core/log";
import type { CodeLensProviders } from "./features/codeLenses";
import type { VSCodeCommands } from "./features/commands";
import type { ContentProviders } from "./features/contentProviders";
import { registerConnectedColumnsCommand } from "./features/lineage/connectedColumnsCommand";
import type { DbtLineageService } from "./features/lineage/dbtLineageService";
import type { WebviewViewProviders } from "./features/panels";
import type { DbtPowerUserActionsCenter } from "./features/projectPicker/actionsCenter";
import type { FileAssociationsCommand } from "./features/projectSetup/fileAssociations";
import type { ProjectConfigCommands } from "./features/projectSetup/projectConfigCommands";
import type { StatusBars } from "./features/statusBars";
import type { TreeviewProviders } from "./features/treeViews";
import type { CurrentProject } from "./projects/currentProject";
import { registerFusionClientDiagnostics } from "./projects/fusionClientDiagnostics";
import type { FusionClientPool } from "./projects/fusionClientPool";
import type { FusionStatus } from "./projects/fusionStatus";
import type { ProjectEnvironments } from "./projects/projectEnvironments";
import type { ProjectRegistry } from "./projects/projectRegistry";
import type { Projects } from "./projects/projects";
import type { RunHistoryService } from "./projects/runHistoryService";
import type { SharedStateService } from "./projects/sharedStateService";
import { onDidChangeSettings, readSetting } from "./settings";
import type { StartupGate } from "./startupGate";

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
        this.projectEnvironments,
        this.fusionStatus,
      ),
    );
    this.own(registerConnectedColumnsCommand(this.dbtLineageService));
    return this.start();
  }

  private async start(): Promise<void> {
    try {
      if (extensions.getExtension(UPSTREAM_EXTENSION_ID)) {
        // A modal with its own action, not a project error.
        // oxlint-disable-next-line eslint/no-restricted-properties
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
      this.watchOpenedFiles();
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

  /** Declares projects from open files now, then again when the files, trust, settings or folders change. */
  private watchOpenedFiles(): void {
    const rescan = () =>
      this.projectRegistry.declareFromDocuments(workspace.textDocuments);
    rescan();
    this.own(
      workspace.onDidOpenTextDocument((document) =>
        this.projectRegistry.declareFromDocuments([document]),
      ),
    );
    this.own(
      window.onDidChangeVisibleTextEditors((editors) =>
        this.projectRegistry.declareFromDocuments(
          editors.map((editor) => editor.document),
        ),
      ),
    );
    this.own(workspace.onDidGrantWorkspaceTrust(rescan));
    this.own(
      onDidChangeSettings(["enabled"], (change) => {
        if (change.affects()) {
          rescan();
        }
      }),
    );
    this.own(workspace.onDidChangeWorkspaceFolders(rescan));
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
