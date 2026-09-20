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
import { DbtPowerUserActionsCenter } from "./quickpick";
import { AltimateAuthService } from "./services/altimateAuthService";
import {
  clearCachedCredits,
  fetchAndCacheCredits,
  handleExecutionsExhausted,
  updateCachedAvailableExecutions,
} from "./services/creditsService";
import { StatusBars } from "./statusbar";
import { TelemetryService } from "./telemetry";
import { TreeviewProviders } from "./treeview_provider";
import { ValidationProvider } from "./validation_provider";
import { WebviewViewProviders } from "./webview_provider";
import { WhatsNewPanel } from "./webview_provider/whatsNewPanel";

enum PromptAnswer {
  YES = "Yes",
  NO = "No",
}

const POWER_USER_EXTENSION_MARKER = "innoverio.vscode-dbt-power-user";
const UPSTREAM_EXTENSION_ID = "innoverio.vscode-dbt-power-user";
const UNINSTALL_POWER_USER = "Uninstall Power User";

// `process.on("unhandledRejection")` fires for every rejection in the
// extension host — including rejections originating in other extensions
// (GitLens, Ruff, SQLFluff, VS Code core RPC, etc.) that happen to be
// loaded in the same process. Without filtering, our `catchAllError`
// telemetry attributes other vendors' failures to power-user, inflating
// our error volume by ~5-10x and polluting triage. Restrict forwarding
// to rejections whose stack points at the published extension directory.
export function isPowerUserRejection(reason: unknown): boolean {
  if (reason === null || reason === undefined) {
    return false;
  }
  const stack = (reason as { stack?: unknown }).stack;
  return (
    typeof stack === "string" && stack.includes(POWER_USER_EXTENSION_MARKER)
  );
}

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
    private telemetry: TelemetryService,
    private hoverProviders: HoverProviders,
    private validationProvider: ValidationProvider,
    private altimateRequest: AltimateRequest,
    private altimateAuthService: AltimateAuthService,
    private whatsNewPanel: WhatsNewPanel,
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
      this.telemetry,
      this.hoverProviders,
      this.validationProvider,
      this.whatsNewPanel,
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

      // VS Code's `@vscode/extension-telemetry` library auto-emits an
      // `unhandlederror` event for uncaught promise rejections, but it only
      // captures `name`/`message`/`stack` (baseTelemetrySender.sendErrorData)
      // and skips `error.code`. That makes IPC failures like `Channel
      // closed` (errno `ERR_IPC_CHANNEL_CLOSED`), `EPIPE`, `EBADF`, etc.
      // indistinguishable from each other in App Insights — all just show
      // up with `name="Error"` and `message="Channel closed"`.
      //
      // Route uncaught rejections through `sendTelemetryError` in addition,
      // so they pick up our consistent `error_name` / `error_message` /
      // `error_code` fields plus `dbtIntegrationMode` / `instanceName` /
      // `localMode`. The upstream `unhandlederror` event keeps firing in
      // parallel — both events stream to App Insights, queryable separately.
      //
      // Filter to rejections whose stack originates in our extension; see
      // `isPowerUserRejection` above for the rationale.
      const onUnhandledRejection = (reason: unknown) => {
        if (!isPowerUserRejection(reason)) {
          return;
        }
        try {
          this.telemetry.sendTelemetryError("catchAllError", reason);
        } catch {
          // Telemetry failures must never re-enter the rejection path.
        }
      };
      process.on("unhandledRejection", onUnhandledRejection);
      context.subscriptions.push({
        dispose: () => process.off("unhandledRejection", onUnhandledRejection),
      });

      this.dbtProjectContainer.setContext(context);
      this.dbtProjectContainer.initializeWalkthrough();
      this.whatsNewPanel.checkAndShowOnActivation();
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
        // Listener registration must never block activation; record it so a
        // version-skew failure is observable instead of silently swallowed.
        this.telemetry.sendTelemetryError(
          "creditsListenerRegistrationError",
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
      this.telemetry.sendTelemetryError("extensionActivationError", error);
    }
  }
}
