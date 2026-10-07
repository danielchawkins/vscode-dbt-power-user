import { documentationEditor } from "@fusion-power-user/webview-contract";
import * as path from "path";
import {
  CancellationToken,
  commands,
  Disposable,
  TextEditor,
  Uri,
  WebviewView,
  WebviewViewResolveContext,
  window,
} from "vscode";
import type { Log } from "../../core/log";
import { ExtensionContextStore } from "../../extensionContext";
import { publicationId } from "../../projects/manifest";
import { notifyError } from "../../projects/notifications";
import type { ParseDemand } from "../../projects/parseDemand";
import { activeModelUri } from "../../projects/previewUri";
import { Project } from "../../projects/project";
import { Projects } from "../../projects/projects";
import { QueryManifestService } from "../../projects/queryManifestService";
import type { SharedStateService } from "../../projects/sharedStateService";
import {
  dispatchMessage,
  Handlers,
  MessageOf,
} from "../../webview/messageRouter";
import { PanelHost } from "../../webview/panelHost";
import { DbtTestService } from "./dbtTestService";
import { DocGenService } from "./docGenService";
import { DBTDocumentation, MetadataColumn } from "./docGenTypes";
import { DocsEditRequests, withProgress } from "./docsEditHandlers";
import { saveDocumentation } from "./docsEditSave";
import { convertColumnNamesByCaseConfig } from "./docsYaml";

type HostMessage = documentationEditor.HostMessage;
type PanelMessage = documentationEditor.PanelMessage;
type SaveMessage = MessageOf<PanelMessage, "saveDocumentation">;

export class DocsEditViewPanel extends PanelHost<HostMessage> {
  public static readonly viewType = "fusionPowerUser.DocsEdit";
  protected readonly entry = "documentationEditor";
  protected readonly csp = {};
  protected override panelDescription = "Edit model documentation";
  private documentation: DBTDocumentation | undefined;
  /** Unsaved drafts by model file path; host memory only, never webview state. */
  private readonly drafts = new Map<
    string,
    documentationEditor.DocumentationDraft
  >();
  private readonly docGenService: DocGenService;
  private readonly dbtTestService: DbtTestService;
  private loadedFromManifest = false;
  private onMessageDisposable: Disposable | undefined;
  private demandSubscription: Disposable | undefined;

  public constructor(
    private projects: Projects,
    extensionContext: ExtensionContextStore,
    services: {
      docGenService: DocGenService;
      dbtTestService: DbtTestService;
      queryManifestService: QueryManifestService;
      emitterService: SharedStateService;
    },
    terminal: Log,
    private parseDemand?: ParseDemand,
  ) {
    super(
      extensionContext,
      services.emitterService,
      terminal,
      services.queryManifestService,
    );
    this.docGenService = services.docGenService;
    this.dbtTestService = services.dbtTestService;
    this._disposables.push(
      projects.onDidChangeManifest(() => this.onManifestChanged()),
      projects.onDidRemoveProject((root) => {
        this.forgetDrafts(root);
        void this.onManifestChanged();
      }),
      window.onDidChangeActiveTextEditor(
        async (event: TextEditor | undefined) => {
          this.documentation = undefined;
          if (event === undefined) {
            return;
          }
          if (this._panel) {
            void this.transmitData();
          }
        },
      ),
    );
  }

  override dispose() {
    this.onMessageDisposable?.dispose();
    this.onMessageDisposable = undefined;
    super.dispose();
  }

  private getProject(): Project | undefined {
    if (!window.activeTextEditor) {
      return undefined;
    }
    const currentFilePath = activeModelUri(
      window.activeTextEditor.document.uri,
    );
    return this.projects.get(currentFilePath);
  }

  private async transmitError() {
    await this.post({ command: "renderError" });
  }

  private forgetDrafts(root: Uri) {
    const prefix = root.fsPath.endsWith(path.sep)
      ? root.fsPath
      : root.fsPath + path.sep;
    for (const model of this.drafts.keys()) {
      if (model.startsWith(prefix)) {
        this.drafts.delete(model);
      }
    }
  }

  private saveDraft({ model, draft }: MessageOf<PanelMessage, "saveDraft">) {
    if (draft) {
      this.drafts.set(model, draft);
    } else {
      this.drafts.delete(model);
    }
  }

  private async transmitData() {
    const { documentation, message } =
      await this.docGenService.getUncompiledDocumentationForCurrentActiveFile();
    this.documentation = documentation;
    if (this._panel) {
      await this.post({
        command: "renderDocumentation",
        docs: this.documentation,
        missingDocumentationMessage: message,
        tests: await this.dbtTestService.getTestsForCurrentModel(),
        unitTests: await this.dbtTestService.getUnitTestsForCurrentModel(),
        project: this.getProject()?.getProjectName(),
        docBlocks: this.getDocBlocksForCurrentProject(),
        publication: publicationId(this.queryManifestService.manifestFor()),
        draft: this.documentation
          ? this.drafts.get(this.documentation.filePath)
          : undefined,
      });
    }
  }

  private getDocBlocksForCurrentProject(): Array<{
    name: string;
    path: string;
  }> {
    const manifestEvent = this.queryManifestService.manifestFor();
    if (!manifestEvent?.docMetaMap) {
      return [];
    }

    return Array.from(manifestEvent.docMetaMap.entries()).map(
      ([name, metaData]) => ({
        name,
        path: metaData.path,
      }),
    );
  }

  private async transmitColumns(columns: MetadataColumn[]) {
    await this.post({ command: "renderColumnsFromMetadataFetch", columns });
  }

  public override async resolveWebviewView(
    panel: WebviewView,
    context: WebviewViewResolveContext,
    token: CancellationToken,
  ) {
    super.resolveWebviewView(panel, context, token);
    panel.title = "";
    this.setupWebviewHooks();
    this.followVisibility(panel);
    void this.transmitData();
  }

  /** The documentation editor reads parse-owned fields, so a visible editor keeps the parse current. */
  private followVisibility(panel: WebviewView) {
    this.demandSubscription?.dispose();
    this.demandSubscription = this.parseDemand?.follow(
      () => panel.visible,
      panel.onDidChangeVisibility,
    );
    panel.onDidDispose(() => this.demandSubscription?.dispose());
  }

  private setupWebviewHooks() {
    this.onMessageDisposable?.dispose();
    this.onMessageDisposable = this._panel!.webview.onDidReceiveMessage(
      (message: unknown) => this.handleCommand(message),
      null,
      this._disposables,
    );
  }

  /** Routes an inbound message through the documentation-editor guard and handler map. */
  private async handleCommand(message: unknown): Promise<void> {
    this.dbtTerminal.debug(
      "docsEditPanel:handleCommand",
      "onDidReceiveMessage",
      message,
    );
    await dispatchMessage(
      DocsEditViewPanel.viewType,
      message,
      documentationEditor.isPanelMessage,
      this.handlers(),
      { log: this.dbtTerminal, reply: (response) => this.post(response) },
    );
  }

  private get requests(): DocsEditRequests {
    return new DocsEditRequests({
      terminal: this.dbtTerminal,
      queryManifestService: this.queryManifestService,
      dbtTestService: this.dbtTestService,
      getProject: () => this.getProject(),
      post: (message) => this.post(message),
    });
  }

  /** One handler per documentation-editor panel command. */
  private handlers(): Handlers<PanelMessage> {
    const { requests } = this;
    return {
      ...requests.handlers(),
      ...this.commonHandlers(),
      getCurrentModelDocumentation: () => this.transmitData(),
      saveDraft: (message) => this.saveDraft(message),
      openProblemsTab: () =>
        commands.executeCommand("workbench.action.problems.focus"),
      fetchMetadataFromDatabase: requests.withProject(
        ({ syncRequestId }, project, modelPath) =>
          this.fetchMetadataFromDatabase(project, modelPath, syncRequestId),
      ),
      saveDocumentation: requests.withProject((message) =>
        withProgress("Saving documentation", () => this.saveAndReply(message)),
      ),
    };
  }

  /** Saves, then answers the request with the reloaded documentation and tests. */
  private async saveAndReply(message: SaveMessage): Promise<void> {
    const { syncRequestId } = message;
    const saved = await this.saveDocumentation(message);
    if (!saved) {
      // The panel keeps its edits dirty until a save is confirmed.
      if (syncRequestId) {
        await this.post({
          command: "response",
          args: { syncRequestId, body: { saved: false }, status: true },
        });
      }
      return;
    }
    this.drafts.delete(message.filePath);
    await this.reloadDocumentationFromManifest();
    if (!syncRequestId) {
      return;
    }
    await this.post({
      command: "response",
      args: {
        syncRequestId,
        body: {
          saved: true,
          tests: await this.dbtTestService.getTestsForCurrentModel(),
          unitTests: await this.dbtTestService.getUnitTestsForCurrentModel(),
          documentation: this.documentation,
        },
        status: true,
      },
    });
  }

  private fetchMetadataFromDatabase(
    project: Project,
    modelPath: Uri,
    syncRequestId: string | undefined,
  ) {
    return withProgress(
      "Syncing columns with metadata from database",
      async () => {
        const modelName = path.basename(modelPath.fsPath, ".sql");
        try {
          const columnsInRelation = await project.getColumnsOfModel(modelName);
          const columns = convertColumnNamesByCaseConfig(
            columnsInRelation.map((column) => ({
              name: column.column,
              type: column.dtype.toLowerCase(),
            })),
            modelName,
            this.documentation?.patchPath,
            project.projectRoot.fsPath,
          );
          await this.transmitColumns(columns);
          if (syncRequestId) {
            await this.post({
              command: "response",
              args: { syncRequestId, body: { columns }, status: true },
            });
          }
        } catch (exc) {
          await this.transmitError();
          void notifyError(
            project,
            `Could not fetch metadata for ${modelName} from the database`,
            exc,
          );
          this.dbtTerminal.error(
            "docsEditPanelLoadError",
            `An error occured while fetching metadata for ${modelName} from the database`,
            exc,
          );
          if (syncRequestId) {
            await this.post({
              command: "response",
              args: { syncRequestId, body: {}, status: false },
            });
          }
        }
      },
    );
  }

  private async reloadDocumentationFromManifest() {
    // Force reload from manifest after manifest refresh
    this.loadedFromManifest = false;
    this.documentation = (
      await this.docGenService.getUncompiledDocumentationForCurrentActiveFile()
    ).documentation;
  }

  /** Writes `message` to its schema YAML; false when the user cancels the file dialog or the write fails. */
  private saveDocumentation(message: SaveMessage): Promise<boolean> {
    return saveDocumentation(
      message,
      this.getProject(),
      {
        projects: this.projects,
        terminal: this.dbtTerminal,
        testData: {
          terminal: this.dbtTerminal,
          dbtTestService: this.dbtTestService,
        },
      },
      (error, patchPath) => {
        void this.transmitError();
        void notifyError(
          this.getProject(),
          `Could not save documentation to ${patchPath}`,
          error,
        );
        this.dbtTerminal.error(
          "saveDocumentationError",
          `Could not save documentation to ${patchPath}`,
          error,
        );
      },
    );
  }

  private async onManifestChanged() {
    if (this.documentation !== undefined && this.loadedFromManifest) {
      // don't reload doc panel if documentation is already set, otherwise the
      //  documentation will be overwritten by the one coming from the manifest
      return;
    }
    this.loadedFromManifest = true;
    if (this._panel) {
      void this.transmitData();
    }
  }
}
