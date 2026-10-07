import { lineage, PanelNotice } from "@fusion-power-user/webview-contract";
import * as path from "path";
import { commands, TextEditor, Uri, WebviewViewProvider, window } from "vscode";
import type { Log } from "../../core/log";
import { ExtensionContextStore } from "../../extensionContext";
import { publicationId } from "../../projects/manifest";
import { Project } from "../../projects/project";
import { QueryManifestService } from "../../projects/queryManifestService";
import { SharedStateService } from "../../projects/sharedStateService";
import { dispatchMessage, Handlers } from "../../webview/messageRouter";
import { PanelHost } from "../../webview/panelHost";
import { registerLineageColumnsCommand } from "./connectedColumnsCommand";
import { DbtLineageService } from "./dbtLineageService";
import { connectedColumnsBody } from "./lineageBodies";
import { LineageDetails } from "./lineageDetails";
import { persistLineageSettings, readLineageSettings } from "./lineageSettings";
import {
  ResolvedSourceTable,
  resolveSourceStartingNode,
  SOURCE_YAML_EXTENSIONS,
} from "./lineageSources";

type HostMessage = lineage.HostMessage;
type PanelMessage = lineage.PanelMessage;

/** The view id contributed in `package.json`. */
export const LINEAGE_VIEW_TYPE = "fusionPowerUser.Lineage";

interface LineagePanelView extends WebviewViewProvider {
  init(): void;
  /** Called with the project whose manifest changed, or `undefined` on project removal and panel init. */
  manifestChanged(project: Project | undefined): void;
  changedActiveTextEditor(event: TextEditor | undefined): void;
  changedTextEditorSelection(editor: TextEditor): void;
  handleCommand(message: unknown): Promise<void>;
}

export class LineagePanel
  extends PanelHost<HostMessage>
  implements LineagePanelView
{
  protected readonly entry = "lineage";
  protected readonly csp = {};
  protected override panelDescription = "Lineage panel";
  // The source unique_id the panel last rooted at when a source YAML is the
  // active file. Used to avoid redundant re-renders on every cursor move; the
  // panel only re-roots when the cursor moves onto a different source table.
  private lastRenderedSourceKey: string | undefined;
  // The current project and manifest epoch the panel last saw; a new epoch for the same root means a save.
  private seenPublication:
    { root: string; epoch: number | undefined } | undefined;

  public constructor(
    protected override extensionContext: ExtensionContextStore,
    private terminal: Log,
    private dbtLineageService: DbtLineageService,
    eventEmitterService: SharedStateService,
    protected override queryManifestService: QueryManifestService,
  ) {
    super(
      extensionContext,
      eventEmitterService,
      terminal,
      queryManifestService,
    );
    const columnsCommand = registerLineageColumnsCommand((params) =>
      this.getColumns(params),
    );
    if (columnsCommand) {
      this._disposables.push(columnsCommand);
    }
  }

  private get details(): LineageDetails {
    return new LineageDetails(
      this.queryManifestService,
      this.dbtLineageService,
      this.dbtTerminal,
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
    const event = this.queryManifestService.getEventByCurrentProject();
    if (!event?.event) {
      return;
    }
    const resolved = resolveSourceStartingNode(event.event, editor);
    const key = resolved?.key;
    if (key === this.lastRenderedSourceKey) {
      return;
    }
    // Thread the resolution into the render so getStartingNode doesn't have
    // to traverse sourceMetaMap a second time for the same cursor position.
    this.renderStartingNode(resolved);
  }

  manifestChanged(_project: Project | undefined): void {
    const current = this.queryManifestService.getProject();
    const seen = this.seenPublication;
    const root = current?.projectRoot.fsPath;
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

  protected override onWebviewReady() {
    super.onWebviewReady();
    this.renderStartingNode();
  }

  init() {
    this.terminal.debug("lineagePanel:init", "init", this._panel);
    this.renderStartingNode();
  }

  private renderStartingNode(resolvedSource?: ResolvedSourceTable) {
    if (!this._panel) {
      return;
    }
    this.post({
      command: "render",
      args: {
        ...this.getStartingNode(resolvedSource),
        publication: publicationId(this.queryManifestService.manifestFor()),
      },
    });
  }

  /** Answers a panel request. */
  private respond(syncRequestId: string | undefined, body: unknown): void {
    this.post({
      command: "response",
      args: { syncRequestId, body, status: true },
    });
  }

  /** One handler per lineage panel command. */
  private handlers(): Handlers<PanelMessage> {
    return {
      ...this.commonHandlers(),
      init: () => this.init(),
      openProblemsTab: () =>
        commands.executeCommand("workbench.action.problems.focus"),
      openFile: ({ args }) =>
        commands.executeCommand("vscode.open", Uri.file(args.params.url), {
          preview: false,
          preserveFocus: true,
        }),
      childTables: ({ args, syncRequestId }) =>
        this.respond(
          syncRequestId,
          this.dbtLineageService.getChildTables(args.params),
        ),
      parentTables: ({ args, syncRequestId }) =>
        this.respond(
          syncRequestId,
          this.dbtLineageService.getParentTables(args.params),
        ),
      getColumns: async ({ args, syncRequestId }) =>
        this.respond(
          syncRequestId,
          await this.getColumns({
            table: args.params.table,
            refresh: args.params.refresh ?? false,
          }),
        ),
      getExposureDetails: async ({ args, syncRequestId }) =>
        this.respond(
          syncRequestId,
          await this.details.getExposureDetails(args.params),
        ),
      getRelationships: ({ args, syncRequestId }) =>
        this.respond(
          syncRequestId,
          this.details.getRelationships(args?.params),
        ),
      getFunctionDetails: async ({ args, syncRequestId }) =>
        this.respond(
          syncRequestId,
          await this.details.getFunctionDetails(args.params),
        ),
      getConnectedColumns: async ({ args, syncRequestId }) => {
        const { targets, upstreamExpansion } = args.params;
        const result = await this.dbtLineageService.getConnectedColumns({
          targets,
          upstreamExpansion,
        });
        this.respond(syncRequestId, connectedColumnsBody(result, targets));
      },
      getLineageSettings: ({ syncRequestId }) =>
        this.respond(syncRequestId, readLineageSettings(this.extensionContext)),
      persistLineageSettings: async ({ args, syncRequestId }) => {
        await persistLineageSettings(this.extensionContext, args.params);
        this.respond(syncRequestId, { ok: true });
      },
    };
  }

  async handleCommand(message: unknown): Promise<void> {
    await dispatchMessage(
      LINEAGE_VIEW_TYPE,
      message,
      lineage.isPanelMessage,
      this.handlers(),
      { log: this.dbtTerminal, reply: (response) => this.post(response) },
    );
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
      this.queryManifestService
        .getProject()
        ?.throwDiagnosticsErrorIfAvailable();
    } catch (err) {
      this.dbtTerminal.error(
        "Lineage:getMissingLineageMessage",
        (err as Error).message,
        err,
      );
      return { message: (err as Error).message, type: "error" };
    }

    const project = this.queryManifestService.getProject();
    const graphNotice = project?.graphNotice();
    if (graphNotice) {
      return { message: graphNotice, type: "warning" };
    }
    return { message, type: "warning" };
  }

  private getStartingNode(
    resolvedSource?: ResolvedSourceTable,
  ): lineage.RenderArgs {
    const event = this.queryManifestService.getEventByCurrentProject();
    if (!event?.event) {
      this.dbtTerminal.info("Lineage:getStartingNode", "No event found");
      return {
        missingLineageMessage: this.getMissingLineageMessage(),
      };
    }
    const { nodeMetaMap, functionMetaMap } = event.event;
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
        const node = this.dbtLineageService.createTable(
          event.event,
          url,
          fn.unique_id,
        );
        return { node };
      }
    }

    const _node = nodeMetaMap.lookupByBaseName(tableName);
    if (_node) {
      const key = _node.unique_id;
      const node = this.dbtLineageService.createTable(event.event, url, key);
      return { node };
    }

    // Non-.py fallback: check if the active file is a dbt function.
    const fn = functionMetaMap.get(tableName);
    if (fn) {
      const node = this.dbtLineageService.createTable(
        event.event,
        url,
        fn.unique_id,
      );
      return { node };
    }

    // Source YAML: a model/seed/function basename never matches, so by here the
    // active file may be a `sources:` definition. Root at the source the cursor
    // is on (or the file's only source table).
    if (SOURCE_YAML_EXTENSIONS.includes(ext)) {
      const resolved =
        resolvedSource ?? resolveSourceStartingNode(event.event, editor);
      if (resolved) {
        // Record the key before the createTable null-check: if the service
        // fails for this key, the selection guard must still short-circuit
        // instead of re-triggering a full render on every cursor move.
        this.lastRenderedSourceKey = resolved.key;
        const node = this.dbtLineageService.createTable(
          event.event,
          resolved.table.path ?? url,
          resolved.key,
        );
        if (node) {
          return { node };
        }
      }
    }

    this.dbtTerminal.info(
      "Lineage:getStartingNode",
      `No node found for ${tableName}`,
    );
    return {
      missingLineageMessage: this.getMissingLineageMessage(),
    };
  }

  /** The columns the lineage panel shows for `table`. */
  private getColumns(params: { table: string; refresh: boolean }) {
    return this.details.getColumns(params);
  }
}
