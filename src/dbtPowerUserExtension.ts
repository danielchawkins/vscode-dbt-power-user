import type { Disposable } from "vscode";
import { commands, extensions, window, workspace } from "vscode";
import { registerRuntimeTimings } from "./benchmark/runtimeTimings";
import type { Log } from "./core/log";
import { registerConnectedColumnsCommand } from "./features/lineage/connectedColumnsCommand";
import type { DbtLineageService } from "./features/lineage/dbtLineageService";
import type { StatusBars } from "./features/statusBars";
import { registerFusionClientDiagnostics } from "./projects/clients/fusionClientDiagnostics";
import type { FusionClientPool } from "./projects/clients/fusionClientPool";
import type { FusionStatus } from "./projects/clients/fusionStatus";
import type { ProjectEnvironments } from "./projects/clients/projectEnvironments";
import type { Projects } from "./projects/project/projects";
import type { ProjectRegistry } from "./projects/registry/projectRegistry";
import { onDidChangeSettings, readSetting } from "./settings";
import type { StartupGate } from "./startupGate";

const UPSTREAM_EXTENSION_ID = "innoverio.vscode-dbt-power-user";
const UNINSTALL_POWER_USER = "Uninstall Power User";

/** The collaborators activation starts, watches and stops. */
export interface ExtensionServices {
  projects: Projects;
  statusBars: StatusBars;
  log: Log;
  projectRegistry: ProjectRegistry;
  fusionClientPool: FusionClientPool;
  fusionStatus: FusionStatus;
  startupGate: StartupGate;
  dbtLineageService: DbtLineageService;
  projectEnvironments: ProjectEnvironments;
}

export class DBTPowerUserExtension implements Disposable {
  private disposables: Disposable[] = [];
  private disposed = false;
  private projects: Projects;
  private statusBars: StatusBars;
  private dbtTerminal: Log;
  private projectRegistry: ProjectRegistry;
  private fusionClientPool: FusionClientPool;
  private fusionStatus: FusionStatus;
  private startupGate: StartupGate;
  private dbtLineageService: DbtLineageService;
  private projectEnvironments: ProjectEnvironments;

  /**
   * `services` are what activation starts, watches and stops. `owned` is everything the extension disposes, in
   * construction order: disposal runs last one first, so the first entries (shared state, run history) go last.
   */
  constructor(services: ExtensionServices, owned: readonly Disposable[]) {
    this.projects = services.projects;
    this.statusBars = services.statusBars;
    this.dbtTerminal = services.log;
    this.projectRegistry = services.projectRegistry;
    this.fusionClientPool = services.fusionClientPool;
    this.fusionStatus = services.fusionStatus;
    this.startupGate = services.startupGate;
    this.dbtLineageService = services.dbtLineageService;
    this.projectEnvironments = services.projectEnvironments;
    this.disposables.push(...owned);
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
      registerFusionClientDiagnostics({
        registry: this.projectRegistry,
        pool: this.fusionClientPool,
        environments: this.projectEnvironments,
        status: this.fusionStatus,
      }),
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

  /**
   * Declares projects from files shown in an editor now, then again when the visible editors, trust, settings or
   * folders change. A document opened without an editor (an agent's edit, a language server, a search) declares
   * nothing.
   */
  private watchOpenedFiles(): void {
    const rescan = () =>
      this.projectRegistry.declareFromDocuments(
        window.visibleTextEditors.map((editor) => editor.document),
      );
    rescan();
    this.own(window.onDidChangeVisibleTextEditors(rescan));
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
