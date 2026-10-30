import type { PanelNotice } from "@fusion-power-user/webview-contract";
import { lineage } from "@fusion-power-user/webview-contract";
import * as path from "node:path";
import type {
  CancellationToken,
  Event,
  TextEditor,
  WebviewPanel,
  WebviewView,
  WebviewViewProvider,
  WebviewViewResolveContext,
} from "vscode";
import { commands, Uri, window } from "vscode";
import type { Log } from "../../core/log";
import { USE_STRICT_ANALYSIS_COMMAND } from "../../core/snapshot/schemaOrigin";
import type { NeedsStrict } from "../../core/snapshot/strictNeeded";
import { strictNeededMessage } from "../../core/snapshot/strictNeeded";
import type { ExtensionContextStore } from "../../extensionContext";
import { publicationId } from "../../projects/manifest/manifest";
import type { MetadataDemand } from "../../projects/manifest/metadataDemand";
import type { CurrentProject } from "../../projects/project/currentProject";
import type { Project } from "../../projects/project/project";
import type { QueryManifestService } from "../../projects/project/queryManifestService";
import type { Handlers } from "../../webview/messageRouter";
import { PanelHost } from "../../webview/panelHost";
import { ColumnTraceRequests } from "./columnTraceRequests";
import { registerLineageColumnsCommand } from "./connectedColumnsCommand";
import { detailRequestHandlers } from "./lineageDetailHandlers";
import { LineageDetails } from "./lineageDetails";
import type { LineageService } from "./lineageService";
import type { ResolvedSourceTable } from "./lineageSources";
import {
  resolveSourceStartingNode,
  SOURCE_YAML_EXTENSIONS,
} from "./lineageSources";
import { columnTraceHandlers } from "./lineageTraceHandlers";

type HostMessage = lineage.HostMessage;
type PanelMessage = lineage.PanelMessage;

/** The view id contributed in `package.json`. */
export const LINEAGE_VIEW_TYPE = "fusionPowerUser.Lineage";

/** The panel notice for a project whose effective static-analysis mode computes no column lineage. */
function staticAnalysisNotice(needs: NeedsStrict): PanelNotice {
  return {
    message: strictNeededMessage(needs),
    type: "warning",
    actions: [{ title: "Use strict analysis", action: "useStrictAnalysis" }],
  };
}

/** Runs the notice button's command for the Current Project's root. */
function useStrictAnalysis(root: Uri | undefined): Thenable<unknown> {
  return commands.executeCommand(USE_STRICT_ANALYSIS_COMMAND, root);
}

interface LineagePanelView extends WebviewViewProvider {
  init(): void;
  /** Called with the project whose manifest changed, or `undefined` on project removal and panel init. */
  manifestChanged(project: Project | undefined): void;
  changedActiveTextEditor(event: TextEditor | undefined): void;
  changedTextEditorSelection(editor: TextEditor): void;
}

export class LineagePanel
  extends PanelHost<HostMessage, PanelMessage, lineage.ResponseBodies>
  implements LineagePanelView
{
  public override viewType = LINEAGE_VIEW_TYPE;
  protected readonly entry = "lineage";
  protected readonly csp = {};
  protected readonly guard = lineage.isPanelMessage;
  protected override panelDescription = "Lineage panel";
  // The source unique_id the panel last rooted at when a source YAML is the
  // active file. Used to avoid redundant re-renders on every cursor move; the
  declare protected extensionContext: ExtensionContextStore;
  private terminal: Log;
  private lineageService: LineageService;
  private metadataDemand: MetadataDemand | undefined;
  private readonly queryManifestService: QueryManifestService;
  private readonly currentProject: CurrentProject;
  // panel only re-roots when the cursor moves onto a different source table.
  private lastRenderedSourceKey: string | undefined;
  // The current project and manifest epoch the panel last saw; a new epoch for the same root means a save.
  private seenPublication:
    | { root: string; epoch: number | undefined }
    | undefined;
  // The column trace whose requests are in flight; a new trace, a cancel, or the end of a page ends them.
  private readonly columnTraces = new ColumnTraceRequests();

  public constructor({
    extensionContext,
    terminal,
    lineageService,
    queryManifestService,
    currentProject,
    metadataDemand,
  }: {
    extensionContext: ExtensionContextStore;
    terminal: Log;
    lineageService: LineageService;
    queryManifestService: QueryManifestService;
    currentProject: CurrentProject;
    metadataDemand?: MetadataDemand;
  }) {
    super({ extensionContext, log: terminal });
    this.queryManifestService = queryManifestService;
    this.currentProject = currentProject;
    this.terminal = terminal;
    this.lineageService = lineageService;
    this.metadataDemand = metadataDemand;
    const columnsCommand = registerLineageColumnsCommand((params) =>
      this.getColumns(params),
    );
    if (columnsCommand) {
      this._disposables.push(columnsCommand);
    }
    this._disposables.push(this.columnTraces);
  }

  /**
   * The lineage drawer reads descriptions, tests and meta, which only the parse supplies, so a visible view keeps
   * the parse demand; then the base renders the page and listens to it.
   */
  public override resolveWebviewView(
    panel: WebviewView,
    context: WebviewViewResolveContext<unknown>,
    token: CancellationToken,
  ): void | Thenable<void> {
    this.followDemand(panel, this.metadataDemand);
    return super.resolveWebviewView(panel, context, token);
  }

  /** Re-renders the starting node on every `event`, so the static-analysis notice follows the client. */
  renderOn(event: Event<void>): void {
    this._disposables.push(event(() => this.renderStartingNode()));
  }

  private get details(): LineageDetails {
    return new LineageDetails(
      this.currentProject,
      this.lineageService,
      this.log,
    );
  }

  public changedActiveTextEditor(event: TextEditor | undefined) {
    if (event === undefined) {
      return;
    }
    if (!this._panel) {
      return;
    }
    // A different file is now active; forget the previously rooted source so a
    // source YAML re-rooted later (or on return) is always re-rendered.
    this.lastRenderedSourceKey = undefined;
    this.renderStartingNode();
  }

  // Re-root the lineage when the cursor moves to a different source table
  // within an open source YAML. This is what makes opening a `sources:` file
  // and clicking on a `- name:` entry show that source's lineage. Guarded so
  // ordinary cursor movement (same table, or any non-source file) never triggers
  // a redundant re-render.
  public changedTextEditorSelection(editor: TextEditor) {
    if (!this._panel) {
      return;
    }
    if (editor !== window.activeTextEditor) {
      return;
    }
    const ext = path.extname(editor.document.fileName).toLowerCase();
    if (!SOURCE_YAML_EXTENSIONS.includes(ext)) {
      return;
    }
    const manifest = this.currentProject.current?.manifest;
    if (!manifest) {
      return;
    }
    const resolved = resolveSourceStartingNode(manifest, editor);
    const key = resolved?.key;
    if (key === this.lastRenderedSourceKey) {
      return;
    }
    // Thread the resolution into the render so getStartingNode doesn't have
    // to traverse sourceMetaMap a second time for the same cursor position.
    this.renderStartingNode(resolved);
  }

  manifestChanged(_project: Project | undefined): void {
    const current = this.currentProject.current;
    const seen = this.seenPublication;
    const root = current?.root.fsPath;
    const epoch = this.queryManifestService.manifestFor()?.publicationEpoch;
    const saved =
      seen !== undefined &&
      seen.root === root &&
      seen.epoch !== undefined &&
      seen.epoch !== epoch;
    this.seenPublication = root === undefined ? undefined : { root, epoch };
    if (saved && this._panel) {
      // The webview redraws drawn column lineage, then asks for the starting node through `init`.
      this.post({ command: "projectSaved" });
      return;
    }
    this.renderStartingNode();
  }

  protected override onWebviewReady(page: WebviewView | WebviewPanel) {
    super.onWebviewReady(page);
    this.renderStartingNode();
  }

  /** A page that ends takes its column trace's requests with it, so no answer goes to a page that is gone. */
  protected override endPage(page: WebviewView | WebviewPanel) {
    this.columnTraces.cancel();
    super.endPage(page);
  }

  init() {
    this.terminal.debug("lineagePanel:init", "init", this._panel);
    this.renderStartingNode();
  }

  private renderStartingNode(resolvedSource?: ResolvedSourceTable) {
    if (!this._panel) {
      return;
    }
    const start = this.getStartingNode(resolvedSource);
    const needs = this.lineageService.columnsNeedStrict();
    this.post({
      command: "render",
      args: {
        ...start,
        ...(needs !== undefined && start.node !== undefined
          ? {
              missingLineageMessage: staticAnalysisNotice(needs),
              columnsNeedStrict: true,
            }
          : {}),
        publication: publicationId(this.queryManifestService.manifestFor()),
      },
    });
  }

  /** The handlers that answer a lineage query; each body is typed by the command it answers. */
  private queryRequestHandlers(): Pick<
    Handlers<PanelMessage>,
    | "childTables"
    | "parentTables"
    | "tableEdges"
    | "getProjectGraph"
    | "getColumns"
    | "getRelationships"
  > {
    return {
      getProjectGraph: ({ syncRequestId }) =>
        this.respond(
          "getProjectGraph",
          syncRequestId,
          this.lineageService.getProjectGraph(),
        ),
      childTables: ({ args, syncRequestId }) =>
        this.respond(
          "childTables",
          syncRequestId,
          this.lineageService.getChildTables(args.params),
        ),
      parentTables: ({ args, syncRequestId }) =>
        this.respond(
          "parentTables",
          syncRequestId,
          this.lineageService.getParentTables(args.params),
        ),
      tableEdges: ({ args, syncRequestId }) =>
        this.respond(
          "tableEdges",
          syncRequestId,
          this.lineageService.getTableEdges(args.params),
        ),
      getColumns: async ({ args, syncRequestId }) =>
        this.respond(
          "getColumns",
          syncRequestId,
          await this.getColumns({
            table: args.params.table,
            refresh: args.params.refresh ?? false,
          }),
        ),
      getRelationships: ({ args, syncRequestId }) =>
        this.respond(
          "getRelationships",
          syncRequestId,
          this.details.getRelationships(args?.params),
        ),
    };
  }

  /** One handler per lineage panel command. */
  protected override handlers(
    page: WebviewView | WebviewPanel,
  ): Handlers<PanelMessage> {
    return {
      ...this.commonHandlers(page),
      init: () => this.init(),
      openProblemsTab: () =>
        commands.executeCommand("workbench.action.problems.focus"),
      runNoticeAction: () =>
        useStrictAnalysis(this.currentProject.current?.root),
      openFile: ({ args }) =>
        commands.executeCommand("vscode.open", Uri.file(args.params.url), {
          preview: false,
          preserveFocus: true,
        }),
      ...this.queryRequestHandlers(),
      ...columnTraceHandlers({
        lineageService: this.lineageService,
        traces: this.columnTraces,
        respond: (command, syncRequestId, body) =>
          this.respond(command, syncRequestId, body),
      }),
      ...detailRequestHandlers({
        details: this.details,
        extensionContext: this.extensionContext,
        respond: (command, syncRequestId, body) =>
          this.respond(command, syncRequestId, body),
      }),
    };
  }

  private static readonly DBT_FILE_EXTENSIONS = [".sql", ".py", ".csv"];

  private getFilename(): string | undefined {
    const editor = window.activeTextEditor;
    if (!editor) {
      return undefined;
    }
    const fileName = editor.document.fileName;
    const ext = path.extname(fileName).toLowerCase();
    if (LineagePanel.DBT_FILE_EXTENSIONS.includes(ext)) {
      return path.basename(fileName, ext);
    }
    return path.basename(fileName);
  }

  private getMissingLineageMessage(): PanelNotice {
    const message =
      "A valid dbt file (model, seed etc.) needs to be open and active in the editor area above to view lineage";
    try {
      this.currentProject.current?.throwDiagnosticsErrorIfAvailable();
    } catch (err) {
      this.log.error(
        "Lineage:getMissingLineageMessage",
        (err as Error).message,
        err,
      );
      return { message: (err as Error).message, type: "error" };
    }

    const project = this.currentProject.current;
    const graphNotice = project?.graphNotice();
    if (graphNotice) {
      return { message: graphNotice, type: "warning" };
    }
    return { message, type: "warning" };
  }

  private getStartingNode(
    resolvedSource?: ResolvedSourceTable,
  ): lineage.RenderArgs {
    const manifest = this.currentProject.current?.manifest;
    if (!manifest) {
      this.log.info("Lineage:getStartingNode", "No event found");
      return {
        missingLineageMessage: this.getMissingLineageMessage(),
      };
    }
    const { nodeMetaMap, functionMetaMap } = manifest;
    const editor = window.activeTextEditor;
    const tableName = this.getFilename();
    if (!editor || !tableName) {
      return {
        missingLineageMessage: this.getMissingLineageMessage(),
      };
    }
    const url = editor.document.uri.path;
    const ext = path.extname(editor.document.fileName).toLowerCase();

    // For .py files, prioritize function lookup to avoid model/function
    // basename collisions (both could share the same name).
    if (ext === ".py") {
      const fn = functionMetaMap.get(tableName);
      if (fn) {
        const node = this.lineageService.createTable(
          manifest,
          url,
          fn.unique_id,
        );
        return { node };
      }
    }

    const _node = nodeMetaMap.lookupByBaseName(tableName);
    if (_node) {
      const key = _node.unique_id;
      const node = this.lineageService.createTable(manifest, url, key);
      return { node };
    }

    // Non-.py fallback: check if the active file is a dbt function.
    const fn = functionMetaMap.get(tableName);
    if (fn) {
      const node = this.lineageService.createTable(manifest, url, fn.unique_id);
      return { node };
    }

    // Source YAML: a model/seed/function basename never matches, so by here the
    // active file may be a `sources:` definition. Root at the source the cursor
    // is on (or the file's only source table).
    if (SOURCE_YAML_EXTENSIONS.includes(ext)) {
      const resolved =
        resolvedSource ?? resolveSourceStartingNode(manifest, editor);
      if (resolved) {
        // Record the key before the createTable null-check: if the service
        // fails for this key, the selection guard must still short-circuit
        // instead of re-triggering a full render on every cursor move.
        this.lastRenderedSourceKey = resolved.key;
        const node = this.lineageService.createTable(
          manifest,
          resolved.table.path ?? url,
          resolved.key,
        );
        if (node) {
          return { node };
        }
      }
    }

    this.log.info("Lineage:getStartingNode", `No node found for ${tableName}`);
    return {
      missingLineageMessage: this.getMissingLineageMessage(),
    };
  }

  /** The columns the lineage panel shows for `table`. */
  private getColumns(params: { table: string; refresh: boolean }) {
    return this.details.getColumns(params);
  }
}
