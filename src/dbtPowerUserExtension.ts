import { DBTTerminal } from "@altimateai/dbt-integration";
import {
  commands,
  Disposable,
  ExtensionContext,
  extensions,
  window,
  workspace,
} from "vscode";
import { AutocompletionProviders } from "./autocompletion_provider";
import { CodeLensProviders } from "./code_lens_provider";
import { VSCodeCommands } from "./commands";
import { ContentProviders } from "./content_provider";
import { DBTProjectContainer } from "./dbt_client/dbtProjectContainer";
import { DefinitionProviders } from "./definition_provider";
import { DocumentFormattingEditProviders } from "./document_formatting_edit_provider";
import { HoverProviders } from "./hover_provider";
import { FusionClientPool } from "./lsp/fusionClientPool";
import { FusionStatus } from "./lsp/fusionStatus";
import { ProjectContext } from "./projects/projectContext";
import { ProjectRegistry } from "./projects/projectRegistry";
import { DbtPowerUserActionsCenter } from "./quickpick";
import { StatusBars } from "./statusbar";
import { TreeviewProviders } from "./treeview_provider";
import { ValidationProvider } from "./validation_provider";
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
    private dbtProjectContainer: DBTProjectContainer,
    private webviewViewProviders: WebviewViewProviders,
    private autocompletionProviders: AutocompletionProviders,
    private definitionProviders: DefinitionProviders,
    private vscodeCommands: VSCodeCommands,
    private treeviewProviders: TreeviewProviders,
    private contentProviders: ContentProviders,
    private codeLensProviders: CodeLensProviders,
    private documentFormattingEditProviders: DocumentFormattingEditProviders,
    private statusBars: StatusBars,
    private puStatusBars: DbtPowerUserActionsCenter,
    private dbtTerminal: DBTTerminal,
    private hoverProviders: HoverProviders,
    private validationProvider: ValidationProvider,
    private projectRegistry: ProjectRegistry,
    private projectContext: ProjectContext,
    private fusionClientPool: FusionClientPool,
    private fusionStatus: FusionStatus,
  ) {
    this.disposables.push(
      this.dbtProjectContainer,
      this.webviewViewProviders,
      this.definitionProviders,
      this.autocompletionProviders,
      this.treeviewProviders,
      this.contentProviders,
      this.codeLensProviders,
      this.vscodeCommands,
      this.documentFormattingEditProviders,
      this.statusBars,
      this.puStatusBars,
      this.hoverProviders,
      this.validationProvider,
      this.projectRegistry,
      this.projectContext,
      this.fusionClientPool,
      this.fusionStatus,
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

  async deactivate(): Promise<void> {
    await this.fusionClientPool.stop();
    this.dispose();
  }

  async activate(context: ExtensionContext): Promise<void> {
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
        folders.every(
          (folder) =>
            !workspace.getConfiguration("dbt", folder.uri).get("enabled", true),
        )
      ) {
        return;
      }

      this.dbtProjectContainer.setContext(context);
      await this.projectRegistry.initialize();
      this.fusionClientPool.initialize();
      this.fusionStatus.initialize();
      await this.dbtProjectContainer.detectDBT();
      await this.dbtProjectContainer.initializeDBTProjects();
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
