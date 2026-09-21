import { DBTTerminal } from "@altimateai/dbt-integration";
import {
  commands,
  Disposable,
  ExtensionContext,
  extensions,
  window,
  workspace,
} from "vscode";
import { AltimateRequest } from "./altimate";
import { AutocompletionProviders } from "./autocompletion_provider";
import { CodeLensProviders } from "./code_lens_provider";
import { VSCodeCommands } from "./commands";
import { ContentProviders } from "./content_provider";
import { DBTProjectContainer } from "./dbt_client/dbtProjectContainer";
import { DefinitionProviders } from "./definition_provider";
import { DocumentFormattingEditProviders } from "./document_formatting_edit_provider";
import { HoverProviders } from "./hover_provider";
import { ProjectContext } from "./projects/projectContext";
import { ProjectRegistry } from "./projects/projectRegistry";
import { DbtPowerUserActionsCenter } from "./quickpick";
import { AltimateAuthService } from "./services/altimateAuthService";
import {
  clearCachedCredits,
  fetchAndCacheCredits,
  handleExecutionsExhausted,
  updateCachedAvailableExecutions,
} from "./services/creditsService";
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
  static DBT_YAML_SELECTOR = [
    { language: "yaml", scheme: "file" },
    { language: "jinja-yaml", scheme: "file" },
  ];
  static DBT_YAML_SQL_SELECTOR = [
    { language: "jinja-sql", scheme: "file" },
    { language: "sql", scheme: "file" },
    { language: "yaml", scheme: "file" },
    { language: "jinja-yaml", scheme: "file" },
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
    private altimateRequest: AltimateRequest,
    private altimateAuthService: AltimateAuthService,
    private projectRegistry: ProjectRegistry,
    private projectContext: ProjectContext,
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
      await this.dbtProjectContainer.detectDBT();
      await this.dbtProjectContainer.initializeDBTProjects();
      await this.statusBars.initialize();

      // Fetch credits balance if user is authenticated (failures are silently ignored)
      if (this.altimateAuthService.isAuthenticated()) {
        void fetchAndCacheCredits(this.altimateRequest);
      }
      // Keep the cached credits balance live: the backend sets an
      // `X-Credits-Remaining` header on every response, so each action updates
      // the balance with no extra API calls. Guarded so listener registration
      // can never interfere with activation.
      try {
        this.altimateRequest.setCreditsRemainingListener((remaining) =>
          updateCachedAvailableExecutions(remaining),
        );
        // Single central handler: every 402 from any feature shows the same
        // out-of-credits popup.
        this.altimateRequest.setExecutionsExhaustedListener(() =>
          handleExecutionsExhausted(this.altimateRequest),
        );
      } catch (error) {
        this.dbtTerminal.error(
          "creditsListenerRegistrationError",
          "Unable to register credits listeners",
          error,
        );
      }
      workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration("dbt")) {
          return;
        }
        // Credentials changed (sign-in / sign-out / instance switch): the initial
        // activation fetch is gated on auth and never retried, so refresh here.
        if (
          e.affectsConfiguration("dbt.altimateAiKey") ||
          e.affectsConfiguration("dbt.altimateInstanceName")
        ) {
          if (this.altimateAuthService.isAuthenticated()) {
            void fetchAndCacheCredits(this.altimateRequest);
          } else {
            clearCachedCredits();
          }
        }
      });
    } catch (error) {
      this.dbtTerminal.error(
        "extensionActivationError",
        "Unable to activate Fusion Power User",
        error,
      );
    }
  }
}
