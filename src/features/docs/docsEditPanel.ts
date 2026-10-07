import { documentationEditor } from "@fusion-power-user/webview-contract";
import * as path from "path";
import {
  CancellationToken,
  commands,
  Disposable,
  TextEditor,
  Uri,
  WebviewView,
  WebviewViewProvider,
  WebviewViewResolveContext,
  window,
} from "vscode";
import {
  beginWebviewResolve,
  completeWebviewReady,
} from "../../benchmark/runtimeTimings";
import type { Log } from "../../core/log";
import { ExtensionContextStore } from "../../extensionContext";
import { publicationId } from "../../projects/manifest";
import { notifyError } from "../../projects/notifications";
import type { ParseDemand } from "../../projects/parseDemand";
import { activeModelUri } from "../../projects/previewUri";
import { Project } from "../../projects/project";
import { Projects } from "../../projects/projects";
import { QueryManifestService } from "../../projects/queryManifestService";
import {
  dispatchMessage,
  Handlers,
  MessageOf,
} from "../../webview/messageRouter";
import { postToWebview } from "../../webview/panelHost";
import { panelHtml, panelWebviewOptions } from "../../webview/panelHtml";
import { DbtTestService } from "./dbtTestService";
import { DocGenService } from "./docGenService";
import { DBTDocumentation, MetadataColumn } from "./docGenTypes";
import { DocsEditRequests, withSaveProgress } from "./docsEditHandlers";
import { saveDocumentation } from "./docsEditSave";
import { convertColumnNamesByCaseConfig } from "./docsYaml";

type HostMessage = documentationEditor.HostMessage;
type PanelMessage = documentationEditor.PanelMessage;
type SaveMessage = MessageOf<PanelMessage, "saveDocumentation">;

export class DocsEditViewPanel implements WebviewViewProvider, Disposable {
  public static readonly viewType = "fusionPowerUser.DocsEdit";
  private readonly entry = "documentationEditor";
  private _panel: WebviewView | undefined = undefined;
  private documentation?: DBTDocumentation;
  /** Unsaved drafts by model file path; host memory only, never webview state. */
  private readonly drafts = new Map<
    string,
    documentationEditor.DocumentationDraft
  >();
  private readonly docGenService: DocGenService;
  private readonly dbtTestService: DbtTestService;
  private readonly queryManifestService: QueryManifestService;
  private loadedFromManifest = false;
  private _disposables: Disposable[] = [];
  private onMessageDisposable: Disposable | undefined;
  private demandSubscription: Disposable | undefined;

  public constructor(
    private projects: Projects,
    private extensionContext: ExtensionContextStore,
    services: {
      docGenService: DocGenService;
      dbtTestService: DbtTestService;
      queryManifestService: QueryManifestService;
    },
    private terminal: Log,
    private parseDemand?: ParseDemand,
  ) {
    this.docGenService = services.docGenService;
    this.dbtTestService = services.dbtTestService;
    this.queryManifestService = services.queryManifestService;
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

  dispose() {
    this.onMessageDisposable?.dispose();
    this.onMessageDisposable = undefined;
    while (this._disposables.length) {
      this._disposables.pop()?.dispose();
    }
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

  private post(message: HostMessage): Thenable<boolean> | undefined {
    return postToWebview(this._panel, message);
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

  public async resolveWebviewView(
    panel: WebviewView,
    _context: WebviewViewResolveContext,
    _token: CancellationToken,
  ) {
    beginWebviewResolve(this.entry);
    this._panel = panel;
    this.setupWebviewOptions();
    this.renderWebviewView();
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

  private renderWebviewView() {
    const webview = this._panel!.webview;
    webview.html = panelHtml(webview, this.extensionContext.extensionUri, {
      entry: this.entry,
      csp: {},
    });
  }

  private setupWebviewOptions() {
    this._panel!.title = "";
    this._panel!.description = "Edit model documentation";
    this._panel!.webview.options = panelWebviewOptions(
      this.extensionContext.extensionUri,
    );
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
    this.terminal.debug(
      "docsEditPanel:handleCommand",
      "onDidReceiveMessage",
      message,
    );
    await dispatchMessage(
      DocsEditViewPanel.viewType,
      message,
      documentationEditor.isPanelMessage,
      this.handlers(),
      { log: this.terminal, reply: (response) => this.post(response) },
    );
  }

  private get requests(): DocsEditRequests {
    return new DocsEditRequests({
      terminal: this.terminal,
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
      "webview:ready": () => completeWebviewReady(this.entry),
      getCurrentModelDocumentation: () => this.transmitData(),
      saveDraft: (message) => this.saveDraft(message),
      openProblemsTab: () =>
        commands.executeCommand("workbench.action.problems.focus"),
      fetchMetadataFromDatabase: requests.withProject(
        ({ syncRequestId }, project, modelPath) =>
          this.fetchMetadataFromDatabase(project, modelPath, syncRequestId),
      ),
      saveDocumentation: requests.withProject((message) =>
        withSaveProgress("Saving documentation", () =>
          this.saveAndReply(message),
        ),
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
    return withSaveProgress(
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
          this.terminal.error(
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
        terminal: this.terminal,
        testData: {
          terminal: this.terminal,
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
        this.terminal.error(
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
