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
import type { ExtensionContextStore } from "../../extensionContext";
import { publicationId } from "../../projects/manifest/manifest";
import type { ParseDemand } from "../../projects/manifest/parseDemand";
import { notifyError } from "../../projects/output/notifications";
import type { ProjectLookup, Projects } from "../../projects/project/projects";
import type { QueryManifestService } from "../../projects/project/queryManifestService";
import type { SharedStateService } from "../../projects/project/sharedStateService";
import { activeModelUri } from "../../projects/registry/previewUri";
import { USE_STRICT_ANALYSIS_COMMAND } from "../../projects/registry/schemaOrigin";
import type { Handlers, MessageOf } from "../../webview/messageRouter";
import { reply } from "../../webview/messageRouter";
import { PanelHost } from "../../webview/panelHost";
import type {
  ColumnProposalRequests,
  ColumnProposalService,
  ProposalKind,
  ProposalTarget,
} from "./columnProposals";
import { proposalTargetOf } from "./columnProposals";
import type { TypeSourceProject } from "./columnTypeSource";
import type { DbtTestService } from "./dbtTestService";
import type { DocGenService } from "./docGenService";
import type { DBTDocumentation } from "./docGenTypes";
import {
  type DocsProject,
  DocsEditRequests,
  withProgress,
} from "./docsEditHandlers";
import { saveDocumentation } from "./docsEditSave";
import { registerDocsHarnessCommands } from "./docsHarnessCommands";

/** The active editor's project as the panel reads it: the handlers' view plus the adapter for saving. */
type PanelProject = DocsProject &
  TypeSourceProject & { getAdapterType(): string };

/** The projects the panel resolves editors in, and the manifest events it follows. */
type PanelProjects = ProjectLookup<PanelProject> &
  Pick<Projects, "onDidChangeManifest" | "onDidRemoveProject">;

type HostMessage = documentationEditor.HostMessage;
type PanelMessage = documentationEditor.PanelMessage;
type SaveMessage = MessageOf<PanelMessage, "saveDocumentation">;

export class DocsEditViewPanel extends PanelHost<HostMessage, PanelMessage> {
  public static readonly viewType = "fusionPowerUser.DocsEdit";
  public override viewType = DocsEditViewPanel.viewType;
  protected readonly entry = "documentationEditor";
  protected readonly csp = {};
  protected readonly guard = documentationEditor.isPanelMessage;
  protected override panelDescription = "Edit model documentation";
  private documentation: DBTDocumentation | undefined;
  /** Unsaved drafts by model file path; host memory only, never webview state. */
  private readonly drafts = new Map<
    string,
    documentationEditor.DocumentationDraft
  >();
  private readonly docGenService: DocGenService;
  private readonly dbtTestService: DbtTestService;
  private readonly columnProposals: ColumnProposalService;
  private loadedFromManifest = false;
  private projects: PanelProjects;
  private parseDemand: ParseDemand | undefined;

  public constructor(
    projects: PanelProjects,
    extensionContext: ExtensionContextStore,
    services: {
      docGenService: DocGenService;
      dbtTestService: DbtTestService;
      queryManifestService: QueryManifestService;
      emitterService: SharedStateService;
      columnProposals: ColumnProposalService;
      columnProposalRequests: ColumnProposalRequests;
    },
    terminal: Log,
    parseDemand?: ParseDemand,
  ) {
    super(
      extensionContext,
      services.emitterService,
      terminal,
      services.queryManifestService,
    );
    this.projects = projects;
    this.parseDemand = parseDemand;
    this.docGenService = services.docGenService;
    this.dbtTestService = services.dbtTestService;
    this.columnProposals = services.columnProposals;
    const harness = registerDocsHarnessCommands({
      columnProposals: this.columnProposals,
      docGenService: this.docGenService,
      dbtTestService: this.dbtTestService,
      drafts: this.drafts,
      proposalTarget: () => this.proposalTarget(),
      save: (message) => this.saveAndReply(message),
    });
    this._disposables.push(...harness);
    this._disposables.push(
      projects.onDidChangeManifest(() => this.onManifestChanged()),
      projects.onDidRemoveProject((root) => {
        this.forgetDrafts(root);
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

  /** Model paths with an unsaved draft in host memory; the smoke suites check that none leak between them. */
  heldDrafts(): string[] {
    return [...this.drafts.keys()];
  }

  /** The active model's columns for a proposal: the draft's and the YAML's, with the project that answers. */
  private async proposalTarget(
    project = this.getProject(),
  ): Promise<ProposalTarget | undefined> {
    const { documentation } =
      await this.docGenService.getUncompiledDocumentationForCurrentActiveFile();
    if (!documentation || !project) {
      return undefined;
    }
    return proposalTargetOf({
      documentation,
      draft: this.drafts.get(documentation.filePath)?.docs.columns,
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
    this.followDemand(panel, this.parseDemand);
    void this.transmitData();
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
      proposeColumns: ({ kind }) => this.propose(kind, this.getProject()),
      runNoticeAction: () =>
        commands.executeCommand(
          USE_STRICT_ANALYSIS_COMMAND,
          this.getProject()?.projectRoot,
        ),
      saveDocumentation: requests.withProject((message) =>
        withProgress("Saving documentation", () => this.saveAndReply(message)),
      ),
    };
  }

  /** Saves, then answers the request with whether the save was confirmed. */
  private async saveAndReply(message: SaveMessage): Promise<void> {
    const { syncRequestId } = message;
    const saved = await this.saveDocumentation(message);
    if (!saved) {
      // The panel keeps its edits dirty until a save is confirmed.
      if (syncRequestId) {
        await reply(
          { reply: (response) => this.post(response) },
          syncRequestId,
          {
            saved: false,
          } satisfies documentationEditor.ResponseBodies["saveDocumentation"],
        );
      }
      return;
    }
    this.drafts.delete(message.filePath);
    await this.reloadDocumentationFromManifest();
    if (!syncRequestId) {
      return;
    }
    await reply({ reply: (response) => this.post(response) }, syncRequestId, {
      saved: true,
    } satisfies documentationEditor.ResponseBodies["saveDocumentation"]);
  }

  /** Posts the proposals of `kind` for the active model; a superseded or cancelled request posts nothing. */
  private async propose(kind: ProposalKind, project: PanelProject | undefined) {
    const target = await this.proposalTarget(project);
    const payload =
      target && (await this.columnProposals.propose(kind, target));
    if (payload) {
      await this.post({ command: "renderColumnProposals", payload });
    }
  }

  /** A command asked for proposals: waits for the page, makes the active model's documentation current, then proposes. */
  private async onProposalRequest(kind: ProposalKind) {
    if (!(await this.whenReady("bottom", 10_000))) {
      void window.showWarningMessage(
        "The documentation editor did not load; try again",
      );
      return;
    }
    const activeFile =
      window.activeTextEditor &&
      activeModelUri(window.activeTextEditor.document.uri).fsPath;
    if (!this.documentation || this.documentation.filePath !== activeFile) {
      await this.transmitData();
    }
    const project = this.getProject();
    if (!project) {
      const model = activeFile ? path.basename(activeFile, ".sql") : "(none)";
      void window.showWarningMessage(`No dbt project for the model ${model}`);
      return;
    }
    await this.propose(kind, project);
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
