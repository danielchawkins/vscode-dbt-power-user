import {
  DbtIntegrationClient,
  DBTTerminal,
  DeferConfig,
  NotFoundError,
} from "@altimateai/dbt-integration";
import { inject } from "inversify";
import {
  commands,
  ConfigurationTarget,
  env,
  ProgressLocation,
  TextEditor,
  Uri,
  window,
  workspace,
} from "vscode";
import { AltimateRequest, DBTCoreIntegration } from "../altimate";
import { DBTProjectContainer } from "../dbt_client/dbtProjectContainer";
import { AltimateAuthService } from "../services/altimateAuthService";
import { QueryManifestService } from "../services/queryManifestService";
import { SharedStateService } from "../services/sharedStateService";
import { UsersService } from "../services/usersService";
import { TelemetryService } from "../telemetry";
import { getProjectRelativePath } from "../utils";
import {
  AltimateWebviewProvider,
  HandleCommandProps,
  UpdateConfigProps,
} from "./altimateWebviewProvider";

type UpdateConfigPropsArray = {
  config: UpdateConfigProps[];
  projectRoot: string;
};

interface DbtProject {
  projectRoot: string;
  projectName: string;
}

export class InsightsPanel extends AltimateWebviewProvider {
  public static readonly viewType = "dbtPowerUser.Insights";
  protected viewPath = "/insights";
  protected panelDescription = "Toggle Defer to prod and other features";

  private projectIntegrations: DBTCoreIntegration[] | undefined;

  public constructor(
    protected dbtProjectContainer: DBTProjectContainer,
    protected altimateRequest: AltimateRequest,
    private dbtIntegrationClient: DbtIntegrationClient,
    protected telemetry: TelemetryService,
    protected emitterService: SharedStateService,
    @inject("DBTTerminal")
    protected dbtTerminal: DBTTerminal,
    protected queryManifestService: QueryManifestService,
    protected usersService: UsersService,
    protected altimateAuthService: AltimateAuthService,
  ) {
    super(
      dbtProjectContainer,
      altimateRequest,
      telemetry,
      emitterService,
      dbtTerminal,
      queryManifestService,
      usersService,
      altimateAuthService,
    );

    this._disposables.push(
      window.onDidChangeActiveTextEditor(
        async (event: TextEditor | undefined) => {
          if (event === undefined) {
            return;
          }

          if (this._panel) {
            const currentProject = await this.getCurrentProject();

            const projectPath = this.getCurrentProject();
            if (!projectPath) {
              this.dbtTerminal.warn("InsightsPanel", "No project selected");
              return;
            }

            this.sendResponseToWebview({
              command: "renderDeferConfig",
              data: {
                config: currentProject?.getDeferConfig(),
                projectPath: currentProject?.projectRoot.fsPath,
                dbtIntegrationMode: "fusion",
              },
            });
          }
        },
      ),
    );
  }

  private getCurrentProject() {
    const currentFilePath = window.activeTextEditor?.document.uri;
    if (!currentFilePath) {
      this.dbtTerminal.debug("InsightsPanel", "No file selected in the editor");
      return;
    }

    const currentProject =
      this.dbtProjectContainer.findDBTProject(currentFilePath);
    return currentProject;
  }

  private async updateDeferConfig(
    syncRequestId: string | undefined,
    params: UpdateConfigPropsArray,
  ) {
    try {
      this.dbtTerminal.debug("InsightsPanel", "Updating defer config", params);
      if (!params.projectRoot) {
        window.showErrorMessage("Please select a project");
        return;
      }

      const updateConfigs = params.config;
      const target = workspace.workspaceFolders
        ? ConfigurationTarget.WorkspaceFolder
        : ConfigurationTarget.Global;

      this.dbtTerminal.debug(
        "InsightsPanel",
        "config target: ${window.activeTextEditor?.document.uri}",
      );

      const currentConfig: Record<string, DeferConfig> = workspace
        .getConfiguration("dbt")
        .get("deferConfigPerProject", {});
      const root = getProjectRelativePath(Uri.file(params.projectRoot));

      this.dbtTerminal.info(
        "Defer config",
        "updating defer config",
        true,
        root,
        updateConfigs,
      );

      const newConfig = {
        ...currentConfig,
        [root]: {
          ...currentConfig[root],
          ...updateConfigs.reduce((acc: Record<string, any>, param) => {
            acc[param.key] = param.value;
            return acc;
          }, {}),
        },
      };

      const workspaceFolder = workspace.getWorkspaceFolder(
        Uri.file(params.projectRoot),
      );
      await workspace
        .getConfiguration("dbt", workspaceFolder)
        .update("deferConfigPerProject", newConfig, target);

      if (syncRequestId) {
        this.sendResponseToWebview({
          command: "response",
          syncRequestId,
          data: {
            updated: true,
          },
        });
      }

      if (!(
        currentConfig[root].deferToProduction ===
          newConfig[root].deferToProduction &&
        currentConfig[root].manifestPathForDeferral ===
          newConfig[root].manifestPathForDeferral &&
        currentConfig[root].favorState === newConfig[root].favorState
      )) {
        window.withProgress(
          {
            location: ProgressLocation.Notification,
            title: "Applying defer config...",
            cancellable: false,
          },
          async () => {
            await this.dbtProjectContainer
              .findDBTProject(Uri.file(params.projectRoot))
              ?.applyDeferConfig();
          },
        );
      }
    } catch (err) {
      this.dbtTerminal.error(
        "InsightsPanel",
        "error while updating defer config",
        err,
      );
      this.sendResponseToWebview({
        command: "response",
        syncRequestId,
        data: {
          updated: false,
        },
        error: (err as Error).message,
      });
    }
  }

  private async fetchProjectIntegrations(
    syncRequestId: string | undefined,
    params: { clearCache?: boolean },
  ) {
    try {
      if (params.clearCache) {
        this.projectIntegrations = undefined;
      }
      if (this.projectIntegrations) {
        if (syncRequestId) {
          this.sendResponseToWebview({
            command: "response",
            syncRequestId,
            data: this.projectIntegrations,
          });
        }
        return;
      }

      if (!this.altimateAuthService.handlePreviewFeatures()) {
        this.projectIntegrations = [];
        if (syncRequestId) {
          this.sendResponseToWebview({
            command: "response",
            syncRequestId,
            data: this.projectIntegrations,
          });
        }
        return;
      }

      this.dbtTerminal.debug("InsightsPanel", "Fetching project integrations");
      const response = await this.altimateRequest.fetchProjectIntegrations();

      if (!response?.length) {
        this.dbtTerminal.debug("InsightsPanel", "Missing project integrations");
        window
          .showInformationMessage(
            "You need to set up integration in SaaS. Please check the documentation",
            ...["View", "Cancel"],
          )
          .then((selection) => {
            if (selection === "View") {
              env.openExternal(
                Uri.parse("https://docs.myaltimate.com/test/defertoprod"),
              );
            }
          });
      }

      this.projectIntegrations = response;
      if (syncRequestId) {
        this.sendResponseToWebview({
          command: "response",
          syncRequestId,
          data: response,
        });
      }
    } catch (err) {
      this.dbtTerminal.error(
        "InsightsPanel",
        `could not fetch project integrations`,
        err,
      );
      this.sendResponseToWebview({
        command: "response",
        syncRequestId,
        data: {
          response: [],
        },
        error: (err as Error).message,
      });
    }
  }

  private async testRemoteManifest(
    syncRequestId: string | undefined,
    dbtCoreIntegrationId: number,
  ) {
    try {
      this.dbtTerminal.debug("InsightsPanel", "Fetching manifest signed url");
      const response = await this.dbtIntegrationClient.fetchArtifactUrl(
        "manifest",
        dbtCoreIntegrationId,
      );
      if (syncRequestId) {
        this.sendResponseToWebview({
          command: "response",
          syncRequestId,
          body: response,
        });
      }
    } catch (err) {
      const errorMessage =
        err instanceof NotFoundError
          ? "No remote manifest file present for selected dbt core integration"
          : (err as Error).message;
      window.showErrorMessage(
        `Could not download remote manifest: ${errorMessage}`,
      );
      this.dbtTerminal.error(
        "InsightsPanel",
        `could not download remote manifest`,
        err,
      );
      this.sendResponseToWebview({
        command: "response",
        syncRequestId,
        data: {
          response: [],
        },
        error: (err as Error).message,
      });
    }
  }

  private async getProjects(syncRequestId: string | undefined) {
    try {
      this.dbtTerminal.debug("InsightsPanel", "Fetching projects");
      const projects = this.dbtProjectContainer.getProjects();

      const dbtProjects: DbtProject[] = [];

      projects.forEach((i) => {
        const projectName = i.getProjectName();
        const projectRoot = i.projectRoot;
        dbtProjects.push({
          projectName: projectName,
          projectRoot: projectRoot.fsPath,
        });
      });

      if (syncRequestId) {
        this.sendResponseToWebview({
          command: "response",
          syncRequestId,
          data: dbtProjects,
        });
      }
    } catch (err) {
      this.dbtTerminal.error(
        "InsightsPanel",
        `could not fetch project integrations`,
        err,
      );
      this.sendResponseToWebview({
        command: "response",
        syncRequestId,
        data: {
          response: [],
        },
        error: (err as Error).message,
      });
    }
  }

  private async selectDirectoryForManifest(syncRequestId?: string) {
    const openDialog = await window.showOpenDialog({
      filters: {},
      canSelectFolders: true,
      openLabel: "Select",
      canSelectFiles: false,
      canSelectMany: false,
    });
    if (openDialog === undefined || openDialog.length === 0) {
      this.dbtTerminal.debug("InsightsPanel", "opendialog cancelled");
      this.sendResponseToWebview({
        command: "response",
        syncRequestId,
        data: { error: "Folder not selected" },
        error: "Folder not selected",
      });
      return;
    }

    this.sendResponseToWebview({
      command: "response",
      syncRequestId,
      data: { path: openDialog[0].fsPath },
    });
  }

  async handleCommand(message: HandleCommandProps): Promise<void> {
    const { command, syncRequestId, ...params } = message;

    switch (command) {
      case "selectDirectoryForManifest":
        this.selectDirectoryForManifest(syncRequestId);
        break;
      case "updateDeferConfig":
        await this.updateDeferConfig(
          syncRequestId,
          params as UpdateConfigPropsArray,
        );
        break;
      case "bigqueryCostEstimate":
        this.dbtTerminal.debug(
          "InsightsPanel",
          "insights_panel:handleCommand -> bigqueryCostEstimate",
        );
        const result = await commands.executeCommand(
          "dbtPowerUser.bigqueryCostEstimate",
          { returnResult: true },
        );

        this.sendResponseToWebview({
          command: "response",
          syncRequestId,
          data: result,
        });
        break;
      case "getDeferToProductionConfig":
        const { projectRoot } = params as { projectRoot?: string };
        const project = this.getCurrentProject();
        if (!project) {
          this.sendResponseToWebview({
            command: "response",
            syncRequestId,
            data: {
              error: "No project selected",
            },
            error: "No project selected",
          });
          return;
        }
        const projectPath = project.projectRoot.fsPath;
        const config = project.getDeferConfig();
        this.dbtTerminal.debug(
          "InsightsPanel",
          `getting defer config for ${projectPath}`,
          projectRoot,
        );

        this.sendResponseToWebview({
          command: "response",
          syncRequestId,
          data: {
            config,
            projectPath,
            dbtIntegrationMode: "fusion",
          },
        });
        break;
      case "fetchProjectIntegrations":
        await this.fetchProjectIntegrations(
          syncRequestId,
          params as { clearCache?: boolean },
        );
        break;
      case "testRemoteManifest":
        const { dbtCoreIntegrationId } = params as {
          dbtCoreIntegrationId: number;
        };
        await this.testRemoteManifest(syncRequestId, dbtCoreIntegrationId);
        break;
      case "getProjects":
        await this.getProjects(syncRequestId);
        break;
      default:
        super.handleCommand(message);
        break;
    }
  }
}
