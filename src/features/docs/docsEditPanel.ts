import { documentationEditor } from "@fusion-power-user/webview-contract";
import * as path from "node:path";
import type {
  CancellationToken,
  TextEditor,
  Uri,
  WebviewPanel,
  WebviewView,
  WebviewViewResolveContext,
} from "vscode";
import { commands, window } from "vscode";
import type { Log } from "../../core/log";
import { BOUNDS } from "../../core/timing";
import type { ExtensionContextStore } from "../../extensionContext";
import { publicationId } from "../../projects/manifest/manifest";
import type { MetadataDemand } from "../../projects/manifest/metadataDemand";
import { notifyError } from "../../projects/output/notifications";
import type { ProjectLookup, Projects } from "../../projects/project/projects";
import type { QueryManifestService } from "../../projects/project/queryManifestService";
import type { SharedStateService } from "../../projects/project/sharedStateService";
import { activeModelUri } from "../../projects/registry/previewUri";
import { USE_STRICT_ANALYSIS_COMMAND } from "../../projects/registry/schemaOrigin";
import type { Handlers, MessageOf } from "../../webview/messageRouter";
import { PanelHost } from "../../webview/panelHost";
import type {
  ColumnProposalRequests,
  ColumnProposalService,
  ProposalKind,
  ProposalTarget,
} from "./columnProposals";
import { proposalTargetOf } from "./columnProposals";
import type { TypeSourceProject } from "./columnTypeSource";
import type { DocGenService } from "./docGenService";
import { DocsDrafts } from "./docsDrafts";
import { type DocsProject, DocsEditRequests } from "./docsEditHandlers";
import { saveDocumentation } from "./docsEditSave";
import { registerDocsHarnessCommands } from "./docsHarnessCommands";
import type { ModelTestService } from "./modelTestService";
import { withProgress } from "./progress";

/** The active editor's project as the panel reads it: the handlers' view plus the adapter for saving. */
type PanelProject = DocsProject &
  TypeSourceProject & { getAdapterType(): string };

/** The projects the panel resolves editors in, and the manifest events it follows. */
type PanelProjects = ProjectLookup<PanelProject> &
  Pick<Projects, "onDidChangeManifest" | "onDidRemoveProject">;

type HostMessage = documentationEditor.HostMessage;
type PanelMessage = documentationEditor.PanelMessage;
type SaveMessage = MessageOf<PanelMessage, "saveDocumentation">;

export class DocsEditViewPanel extends PanelHost<
  HostMessage,
  PanelMessage,
  documentationEditor.ResponseBodies
> {
  public static readonly viewType = "fusionPowerUser.DocsEdit";
  public override viewType = DocsEditViewPanel.viewType;
  protected readonly entry = "documentationEditor";
  protected readonly csp = {};
  protected readonly guard = documentationEditor.isPanelMessage;
  protected override panelDescription = "Edit model documentation";
  private documentation: documentationEditor.Documentation | undefined;
  private readonly drafts = new DocsDrafts();
  private readonly docGenService: DocGenService;
  private readonly modelTests: ModelTestService;
  private readonly columnProposals: ColumnProposalService;
  private loadedFromManifest = false;
  private projects: PanelProjects;
  private metadataDemand: MetadataDemand | undefined;

  public constructor({
    projects,
    extensionContext,
    services,
    terminal,
    metadataDemand,
  }: {
    projects: PanelProjects;
    extensionContext: ExtensionContextStore;
    services: {
      docGenService: DocGenService;
      modelTests: ModelTestService;
      queryManifestService: QueryManifestService;
      sharedState: SharedStateService;
      columnProposals: ColumnProposalService;
      columnProposalRequests: ColumnProposalRequests;
    };
    terminal: Log;
    metadataDemand?: MetadataDemand;
  }) {
    super({
      extensionContext,
      sharedState: services.sharedState,
      log: terminal,
      queryManifestService: services.queryManifestService,
    });
    this.projects = projects;
    this.metadataDemand = metadataDemand;
    this.docGenService = services.docGenService;
    this.modelTests = services.modelTests;
    this.columnProposals = services.columnProposals;
    const harness = registerDocsHarnessCommands({
      columnProposals: this.columnProposals,
      docGenService: this.docGenService,
      modelTests: this.modelTests,
      drafts: this.drafts,
      proposalTarget: () => this.proposalTarget(),
      save: async (message) => {
        const uri = window.activeTextEditor?.document.uri;
        if (uri) {
          await this.saveAndReply(message, this.projectOf(uri), uri);
        }
      },
    });
    this._disposables.push(...harness);
    this._disposables.push(
      projects.onDidChangeManifest(() => this.onManifestChanged()),
      projects.onDidRemoveProject((root) => {
        this.drafts.forgetProject(root.fsPath);
        void this.onManifestChanged();
      }),
      services.columnProposalRequests.onDidRequest(
        ({ kind }) => void this.onProposalRequest(kind),
      ),
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

  private getProject(): PanelProject | undefined {
    if (!window.activeTextEditor) {
      return undefined;
    }
    return this.projectOf(window.activeTextEditor.document.uri);
  }

  /** The project that answers for the document at `uri`, with no read of the active editor. */
  private projectOf(uri: Uri): PanelProject | undefined {
    return this.projects.get(activeModelUri(uri));
  }

  private async transmitError() {
    await this.post({ command: "renderError" });
  }

  private saveDraft({ model, draft }: MessageOf<PanelMessage, "saveDraft">) {
    this.drafts.set(model, draft);
  }

  heldDrafts(): string[] {
    return this.drafts.held();
  }

  /** The active model's columns for a proposal: the draft's and the YAML's, with the project that answers. */
  private async proposalTarget(
    uri = window.activeTextEditor?.document.uri,
  ): Promise<ProposalTarget | undefined> {
    const project = uri && this.projectOf(uri);
    const { documentation } = uri
      ? await this.docGenService.getUncompiledDocumentation(
          activeModelUri(uri).fsPath,
        )
      : { documentation: undefined };
    if (!documentation || !project) {
      return undefined;
    }
    return proposalTargetOf({
      documentation,
      draft: this.drafts.draftColumns(documentation.filePath),
      project,
      manifest: this.queryManifestService.manifestFor(),
    });
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
        tests: await this.modelTests.getTestsForCurrentModel(),
        unitTests: await this.modelTests.getUnitTestsForCurrentModel(),
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

    return Array.from(
      manifestEvent.docMetaMap.entries(),
      ([name, metaData]) => ({
        name,
        path: metaData.path,
      }),
    );
  }

  public override async resolveWebviewView(
    panel: WebviewView,
    context: WebviewViewResolveContext,
    token: CancellationToken,
  ) {
    super.resolveWebviewView(panel, context, token);
    panel.title = "";
    this.followDemand(panel, this.metadataDemand);
    void this.transmitData();
  }

  private get requests(): DocsEditRequests {
    return new DocsEditRequests({
      terminal: this.log,
      queryManifestService: this.queryManifestService,
      modelTests: this.modelTests,
      getProject: (uri) => this.projectOf(uri),
      respond: (command, syncRequestId, body) =>
        this.respond(command, syncRequestId, body),
      respondError: (syncRequestId, error) =>
        this.respondError(syncRequestId, error),
    });
  }

  /** One handler per documentation-editor panel command. */
  protected override handlers(
    page: WebviewView | WebviewPanel,
  ): Handlers<PanelMessage> {
    const { requests } = this;
    return {
      ...requests.handlers(),
      ...this.commonHandlers(page),
      getCurrentModelDocumentation: () => this.transmitData(),
      saveDraft: (message) => this.saveDraft(message),
      openProblemsTab: () =>
        commands.executeCommand("workbench.action.problems.focus"),
      proposeColumns: ({ kind }) =>
        this.propose(kind, window.activeTextEditor?.document.uri),
      runNoticeAction: () =>
        commands.executeCommand(
          USE_STRICT_ANALYSIS_COMMAND,
          this.getProject()?.root,
        ),
      saveDocumentation: requests.withProject((message, active) =>
        withProgress("Saving documentation", () =>
          this.saveAndReply(message, this.projectOf(active.uri), active.uri),
        ),
      ),
    };
  }

  /** Saves, then answers the request with whether the save was confirmed. */
  private async saveAndReply(
    message: SaveMessage,
    project: PanelProject | undefined,
    uri: Uri,
  ): Promise<void> {
    const { syncRequestId } = message;
    const saved = await this.saveDocumentation(message, project);
    if (!saved) {
      // The panel keeps its edits dirty until a save is confirmed.
      if (syncRequestId) {
        await this.respond("saveDocumentation", syncRequestId, {
          saved: false,
        });
      }
      return;
    }
    this.drafts.forget(message.filePath);
    await this.reloadDocumentationFromManifest(uri);
    if (!syncRequestId) {
      return;
    }
    await this.respond("saveDocumentation", syncRequestId, { saved: true });
  }

  /** Posts the proposals of `kind` for the active model; a superseded or cancelled request posts nothing. */
  private async propose(kind: ProposalKind, uri: Uri | undefined) {
    const target = await this.proposalTarget(uri);
    const payload =
      target && (await this.columnProposals.propose(kind, target));
    if (payload) {
      await this.post({ command: "renderColumnProposals", payload });
    }
  }

  /** A command asked for proposals: waits for the page, makes the active model's documentation current, then proposes. */
  private async onProposalRequest(kind: ProposalKind) {
    if (!(await this.whenReady("bottom", BOUNDS.pageReadyMs))) {
      void window.showWarningMessage(
        "The documentation editor did not load; try again",
      );
      return;
    }
    const uri = window.activeTextEditor?.document.uri;
    const activeFile = uri && activeModelUri(uri).fsPath;
    if (!this.documentation || this.documentation.filePath !== activeFile) {
      await this.transmitData();
    }
    if (!uri || !this.projectOf(uri)) {
      const model = activeFile ? path.basename(activeFile, ".sql") : "(none)";
      void window.showWarningMessage(`No dbt project for the model ${model}`);
      return;
    }
    await this.propose(kind, uri);
  }

  /** Reloads the documentation of the model at `uri`, the one the save request resolved. */
  private async reloadDocumentationFromManifest(uri: Uri) {
    // Force reload from manifest after manifest refresh
    this.loadedFromManifest = false;
    this.documentation = (
      await this.docGenService.getUncompiledDocumentation(
        activeModelUri(uri).fsPath,
      )
    ).documentation;
  }

  /** Writes `message` to its schema YAML; false when the user cancels the file dialog or the write fails. */
  private saveDocumentation(
    message: SaveMessage,
    project: PanelProject | undefined,
  ): Promise<boolean> {
    return saveDocumentation({
      message,
      activeProject: project,
      deps: {
        projects: this.projects,
        terminal: this.log,
        testData: {
          terminal: this.log,
          modelTests: this.modelTests,
        },
      },
      onFailure: (error, patchPath) => {
        void this.transmitError();
        void notifyError(
          project,
          `Could not save documentation to ${patchPath}`,
          error,
        );
        this.log.error(
          "saveDocumentationError",
          `Could not save documentation to ${patchPath}`,
          error,
        );
      },
    });
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
