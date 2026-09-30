import { commands, Disposable, extensions, window, workspace } from "vscode";
import { registerRuntimeTimings } from "./benchmark/runtimeTimings";
import { CodeLensProviders } from "./code_lens_provider";
import { VSCodeCommands } from "./commands";
import { ProjectConfigCommands } from "./commands/projectConfigCommands";
import { ContentProviders } from "./content_provider";
import { DBTTerminal } from "./dbt_integration";
import { registerFusionClientDiagnostics } from "./fusion/fusionClientDiagnostics";
import { FusionClientPool } from "./fusion/fusionClientPool";
import { FusionStatus } from "./fusion/fusionStatus";
import { CurrentProject } from "./projects/currentProject";
import { DbtTemplateLanguage } from "./projects/dbtTemplateLanguage";
import { ProjectRegistry } from "./projects/projectRegistry";
import { Projects } from "./projects/projects";
import { DbtPowerUserActionsCenter } from "./quickpick";
import { registerConnectedColumnsCommand } from "./services/connectedColumnsCommand";
import { DbtLineageService } from "./services/dbtLineageService";
import { RunHistoryService } from "./services/runHistoryService";
import { SharedStateService } from "./services/sharedStateService";
import { readSetting } from "./settings";
import { StatusBars } from "./statusbar";
import { TreeviewProviders } from "./treeview_provider";
import { WebviewViewProviders } from "./webview_provider";

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
    private dbtTemplateLanguage: DbtTemplateLanguage,
    private dbtLineageService: DbtLineageService,
    /** Disposed after every other collaborator. */
    private sharedState: SharedStateService,
    /** Disposed after every other collaborator except `sharedState`. */
    private runHistoryService: RunHistoryService,
  ) {
    this.disposables.push(
      this.sharedState,
      this.runHistoryService,
      this.dbtTerminal,
      this.projects,
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
      this.dbtTemplateLanguage,
    );
  }

  dispose() {
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

  async activate(): Promise<void> {
    this.own(registerRuntimeTimings());
    try {
      if (extensions.getExtension(UPSTREAM_EXTENSION_ID)) {
        const action = await window.showErrorMessage(
          "Fusion Power User cannot start while dbt Power User is installed.",
          { modal: true },
          UNINSTALL_POWER_USER,
        );
        if (action === UNINSTALL_POWER_USER) {
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
      this.dbtTemplateLanguage.start();
      this.fusionClientPool.initialize();
      this.fusionStatus.initialize();
      this.own(
        registerFusionClientDiagnostics(
          this.projectRegistry,
          this.fusionClientPool,
        ),
      );
      this.own(registerConnectedColumnsCommand(this.dbtLineageService));
      await this.projects.initialize();
      await this.statusBars.initialize();
    } catch (error) {
      this.dbtTerminal.error(
        "extensionActivationError",
        "Unable to activate Fusion Power User",
        error,
      );
    }
  }
}
