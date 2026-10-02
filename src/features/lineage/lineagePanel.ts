import { lineage, PanelNotice } from "@fusion-power-user/webview-contract";
import * as path from "path";
import {
  commands,
  ProgressLocation,
  TextDocument,
  TextEditor,
  Uri,
  Webview,
  WebviewViewProvider,
  window,
} from "vscode";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import { ColumnLineage, panelColumns } from "../../core/lineage";
import { RelationshipParser } from "../../core/manifest";
import {
  DBTTerminal,
  ExposureMetaData,
  FunctionMetaData,
  Ref,
  RESOURCE_TYPE_FUNCTION,
  RESOURCE_TYPE_SOURCE,
  SourceMetaMap,
  SourceTable,
} from "../../dbt_integration";
import { ExtensionContextStore } from "../../extensionContext";
import type { Manifest } from "../../projects/manifestTypes";
import { Project } from "../../projects/project";
import { QueryManifestService } from "../../projects/queryManifestService";
import { SharedStateService } from "../../projects/sharedStateService";
import { readSetting, writeSetting } from "../../settings";
import { dispatchMessage, Handlers } from "../../webview/messageRouter";
import { PanelHost } from "../../webview/panelHost";
import { registerLineageColumnsCommand } from "./connectedColumnsCommand";
import {
  ConnectedColumnsResult,
  DbtLineageService,
  describeNoLineage,
  NoLineage,
  TargetFailure,
} from "./dbtLineageService";

type HostMessage = lineage.HostMessage;
type PanelMessage = lineage.PanelMessage;

/** The global-state key of the lineage view settings other than `defaultExpansion`, which is a user setting. */
const LINEAGE_SETTINGS_KEY = "lineage.viewSettings";

/** The view id contributed in `package.json`. */
export const LINEAGE_VIEW_TYPE = "fusionPowerUser.Lineage";

type StoredLineageSettings = Omit<
  Partial<lineage.LineageSettings>,
  "defaultExpansion"
>;

/** Every key `storedLineageSettings` keeps; the record type makes a new `LineageSettings` key a compile error here. */
const STORED_KEYS: Record<keyof StoredLineageSettings, true> = {
  showSelectEdges: true,
  showNonSelectEdges: true,
  showRefs: true,
  enabledRefSources: true,
  inferenceConfidenceThreshold: true,
  includeSourcesInInference: true,
};

/** The known view settings in `params`, with the confidence threshold clamped to 0..1; other keys are dropped. */
export function storedLineageSettings(
  params: Partial<lineage.LineageSettings>,
): StoredLineageSettings {
  const stored: Record<string, unknown> = {};
  for (const key of Object.keys(
    STORED_KEYS,
  ) as (keyof StoredLineageSettings)[]) {
    if (params[key] !== undefined) {
      stored[key] = params[key];
    }
  }
  const threshold = params.inferenceConfidenceThreshold;
  if (threshold !== undefined) {
    if (Number.isFinite(threshold)) {
      stored.inferenceConfidenceThreshold = Math.min(1, Math.max(0, threshold));
    } else {
      delete stored.inferenceConfidenceThreshold;
    }
  }
  return stored as StoredLineageSettings;
}

export interface LineagePanelView extends WebviewViewProvider {
  init(): void;
  /** Called with the project whose manifest changed, or `undefined` on project removal and panel init. */
  manifestChanged(project: Project | undefined): void;
  changedActiveTextEditor(event: TextEditor | undefined): void;
  changedTextEditorSelection(editor: TextEditor): void;
  handleCommand(message: unknown): Promise<void>;
}

// A source table resolved to the dbt unique_id key the lineage should root at
// (`source.<pkg>.<source>.<table>`).
interface ResolvedSourceTable {
  key: string;
  sourceName: string;
  table: SourceTable;
}

/** The lineage component shows `errors[table]` as a tooltip on that table. */
export function noLineageErrors(
  targets: [string, string][],
  reason: NoLineage,
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const [table] of targets) {
    errors[table] = [describeNoLineage(reason)];
  }
  return errors;
}

/** One tooltip line per failed column, on the column's table. */
export function partialFailureErrors(
  failures: TargetFailure[],
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const { target, message } of failures) {
    const [table, column] = target;
    (errors[table] ??= []).push(
      `Could not read column lineage for ${column}: ${message}`,
    );
  }
  return errors;
}

/** The lineage component's `getConnectedColumns` response body. */
function connectedColumnsBody(
  result: ConnectedColumnsResult,
  targets: [string, string][],
): { column_lineage: ColumnLineage[]; errors?: Record<string, string[]> } {
  if (result.kind === "noLineage") {
    return {
      column_lineage: [],
      errors: noLineageErrors(targets, result.reason),
    };
  }
  return {
    column_lineage: result.columnLineage,
    ...(result.failures
      ? { errors: partialFailureErrors(result.failures) }
      : {}),
  };
}

// 0-based line of `offset` within `text`.
function lineAtOffset(text: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
    }
  }
  return line;
}

export class LineagePanel extends PanelHost implements LineagePanelView {
  protected viewPath = "/lineage";
  protected panelDescription = "Lineage panel";
  // The source unique_id the panel last rooted at when a source YAML is the
  // active file. Used to avoid redundant re-renders on every cursor move; the
  // panel only re-roots when the cursor moves onto a different source table.
  private lastRenderedSourceKey: string | undefined;
  // The current project and manifest epoch the panel last saw; a new epoch for the same root means a save.
  private seenPublication:
    { root: string; epoch: number | undefined } | undefined;

  public constructor(
    protected extensionContext: ExtensionContextStore,
    private terminal: DBTTerminal,
    private dbtLineageService: DbtLineageService,
    eventEmitterService: SharedStateService,
    protected queryManifestService: QueryManifestService,
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
  // and clicking on a `- name:` entry show that source's lineage, mirroring the
  // dbt Cloud IDE. Guarded so ordinary cursor movement (same table, or any
  // non-source file) never triggers a redundant re-render.
  public changedTextEditorSelection(editor: TextEditor) {
    if (!this._panel) {
      return;
    }
    if (editor !== window.activeTextEditor) {
      return;
    }
    const ext = path.extname(editor.document.fileName).toLowerCase();
    if (!LineagePanel.SOURCE_YAML_EXTENSIONS.includes(ext)) {
      return;
    }
    const event = this.queryManifestService.getEventByCurrentProject();
    if (!event?.event) {
      return;
    }
    const resolved = this.resolveSourceStartingNode(event.event, editor);
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
    const epoch = current?.manifest?.publicationEpoch;
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

  private post(message: HostMessage): void {
    void this._panel?.webview.postMessage(message);
  }

  protected onWebviewReady() {
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
      args: this.getStartingNode(resolvedSource),
    });
  }

  /** Answers a component request; the component matches replies by `id`. */
  private respond(syncRequestId: string | undefined, body: unknown): void {
    this.post({
      command: "response",
      args: { id: syncRequestId, syncRequestId, body, status: true },
    });
  }

  private getLineageSettings(): lineage.LineageSettings {
    const stored =
      this.extensionContext.getFromGlobalState<
        Partial<lineage.LineageSettings>
      >(LINEAGE_SETTINGS_KEY) ?? {};
    return {
      showSelectEdges: true,
      showNonSelectEdges: false,
      ...stored,
      defaultExpansion: Math.min(readSetting("lineage.defaultExpansion"), 5),
    };
  }

  private async persistLineageSettings({
    defaultExpansion,
    ...params
  }: Partial<lineage.LineageSettings>): Promise<void> {
    if (defaultExpansion !== undefined) {
      await writeSetting("lineage.defaultExpansion", defaultExpansion);
    }
    const view = storedLineageSettings(params);
    if (Object.keys(view).length > 0) {
      const stored =
        this.extensionContext.getFromGlobalState<StoredLineageSettings>(
          LINEAGE_SETTINGS_KEY,
        ) ?? {};
      this.extensionContext.setToGlobalState(LINEAGE_SETTINGS_KEY, {
        ...stored,
        ...view,
      });
    }
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
        this.respond(syncRequestId, await this.getExposureDetails(args.params)),
      getRelationships: ({ args, syncRequestId }) =>
        this.respond(syncRequestId, this.getRelationships(args?.params)),
      getFunctionDetails: async ({ args, syncRequestId }) =>
        this.respond(syncRequestId, await this.getFunctionDetails(args.params)),
      getConnectedColumns: async ({ args, syncRequestId }) => {
        const { targets, upstreamExpansion } = args.params;
        const result = await this.dbtLineageService.getConnectedColumns({
          targets,
          upstreamExpansion,
        });
        this.respond(syncRequestId, connectedColumnsBody(result, targets));
      },
      showInfoNotification: ({ args }) =>
        window.showInformationMessage(args.params.message),
      getLineageSettings: ({ syncRequestId }) =>
        this.respond(syncRequestId, this.getLineageSettings()),
      persistLineageSettings: async ({ args, syncRequestId }) => {
        await this.persistLineageSettings(args.params);
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
      {
        log: this.dbtTerminal,
        // The lineage component matches replies by `id`.
        reply: ({ args }) =>
          this.post({
            command: "response",
            args: { ...args, id: args.syncRequestId },
          }),
      },
    );
  }

  private async addSourceColumnsFromDB(
    project: Project,
    nodeName: string,
    table: SourceTable,
  ) {
    const columnsFromDB = await project.getColumnsOfSource(
      nodeName,
      table.name,
    );
    console.log("addColumnsFromDB: ", nodeName, " -> ", columnsFromDB);
    return project.mergeColumnsFromDB(table, columnsFromDB);
  }

  /**
   * Extract PK/FK relationships from the current project's manifest.
   * Chains all four sources — `relationships` data tests, model contract
   * foreign keys, naming-convention inference, and semantic-layer entity
   * pairings. Each ref carries a `source` discriminator so the frontend can
   * filter and style per-source. Sources are excluded by default — opt-in via
   * params.
   */
  private getRelationships(params?: {
    includeSources?: boolean;
    allowSelfReference?: boolean;
  }): { refs: Ref[] } {
    const event = this.queryManifestService.getEventByCurrentProject();
    if (!event?.event) {
      return { refs: [] };
    }
    const { testMetaMap, nodeMetaMap, sourceMetaMap, semanticModelMetaMap } =
      event.event;
    const parser = new RelationshipParser(this.terminal);

    const fromTests = parser.fromTests(testMetaMap);
    const fromContracts = parser.fromContracts(nodeMetaMap, sourceMetaMap);
    const fromInference = parser.fromInference(nodeMetaMap, sourceMetaMap, {
      // Emit at the parser's lowest acceptable confidence; UI applies the
      // user-controlled threshold via the popover slider.
      minConfidence: 0.6,
      includeSources: params?.includeSources ?? false,
      allowSelfReference: params?.allowSelfReference ?? false,
    });
    const fromSemantic = parser.fromSemanticEntities(semanticModelMetaMap);

    const refs = [
      ...fromTests,
      ...fromContracts,
      ...fromInference,
      ...fromSemantic,
    ];
    this.terminal.debug(
      "LineagePanel",
      `getRelationships returning ${refs.length} refs (` +
        `tests=${fromTests.length}, contracts=${fromContracts.length}, ` +
        `inferred=${fromInference.length}, semantic=${fromSemantic.length})`,
    );
    return { refs };
  }

  private async getExposureDetails({
    name,
  }: {
    name: string;
  }): Promise<ExposureMetaData | undefined> {
    const event = this.queryManifestService.getEventByCurrentProject();
    if (!event?.event) {
      return;
    }
    const project = this.queryManifestService.getProject();
    if (!project) {
      return;
    }

    const { exposureMetaMap } = event.event;

    // Node IDs use unique_id format (exposure.project.name), but
    // exposureMetaMap is keyed by simple exposure name.
    const splits = name.split(".");
    const exposureName = splits.length >= 3 ? splits[2] : name;
    return exposureMetaMap.get(exposureName);
  }

  private async getFunctionDetails({
    name,
  }: {
    name: string;
  }): Promise<FunctionMetaData | undefined> {
    const event = this.queryManifestService.getEventByCurrentProject();
    if (!event?.event) {
      return;
    }
    const { functionMetaMap } = event.event;
    // Node IDs use unique_id format (function.project.name), but
    // functionMetaMap is keyed by simple function name.
    const splits = name.split(".");
    const functionName = splits.length >= 3 ? splits[2] : name;
    return functionMetaMap.get(functionName);
  }

  private async getColumns({
    table,
    refresh,
  }: {
    table: string;
    refresh: boolean;
  }): Promise<
    | {
        id: string;
        purpose: string;
        columns: {
          table: string;
          name: string;
          datatype: string;
          can_lineage_expand: boolean;
          description: string;
        }[];
        returns?: {
          datatype: string;
          description: string;
        };
        meta?: { [key: string]: any };
      }
    | undefined
  > {
    const event = this.queryManifestService.getEventByCurrentProject();
    if (!event?.event) {
      return;
    }
    const project = this.queryManifestService.getProject();
    if (!project) {
      return;
    }
    const splits = table.split(".");
    const nodeType = splits[0];
    if (nodeType === RESOURCE_TYPE_SOURCE) {
      const { sourceMetaMap } = event.event;
      const sourceName = splits[2];
      const tableName = splits[3];
      const node = sourceMetaMap.get(sourceName);
      if (!node) {
        return;
      }
      const _table = node.tables.find((t) => t.name === tableName);
      if (!_table) {
        return;
      }
      if (refresh) {
        const ok = await window.withProgress(
          {
            title: "Fetching metadata",
            location: ProgressLocation.Notification,
            cancellable: false,
          },
          async () => {
            return await this.addSourceColumnsFromDB(
              project,
              node.name,
              _table,
            );
          },
        );
        if (!ok) {
          window.showErrorMessage(
            "Unable to get columns from DB for model: " +
              node.name +
              " table: " +
              _table.name +
              ".",
          );
          return;
        }
      }
      return {
        id: table,
        purpose: _table.description,
        columns: Object.values(_table.columns)
          .map((c) => ({
            table,
            name: c.name,
            datatype: c.data_type?.toLowerCase() || "",
            can_lineage_expand: false,
            description: c.description,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    }
    if (nodeType === RESOURCE_TYPE_FUNCTION) {
      const tableName = splits[2];
      const { functionMetaMap } = event.event;
      const fn = functionMetaMap.get(tableName);
      if (!fn) {
        return;
      }
      const columns: {
        table: string;
        name: string;
        datatype: string;
        can_lineage_expand: boolean;
        description: string;
      }[] = [];
      if (fn.arguments) {
        for (const arg of fn.arguments) {
          columns.push({
            table,
            name: arg.name,
            datatype: arg.data_type || "",
            can_lineage_expand: false,
            description: arg.description || "",
          });
        }
      }
      return {
        id: table,
        purpose: fn.description || "",
        columns,
        returns: fn.returns
          ? {
              datatype: fn.returns.data_type || "",
              description: fn.returns.description || "",
            }
          : undefined,
      };
    }
    const { nodeMetaMap } = event.event;
    const node = nodeMetaMap.lookupByUniqueId(table);
    if (!node) {
      return;
    }
    // `refresh` is ignored: the language server already supplies model columns and types.
    const inferred = node.path
      ? await this.dbtLineageService.getInferredColumns(
          project.projectRoot.fsPath,
          node.path,
        )
      : undefined;
    return {
      id: table,
      purpose: node.description,
      columns: panelColumns(table, Object.values(node.columns), inferred),
      meta: node.meta,
    };
  }

  private static readonly DBT_FILE_EXTENSIONS = [".sql", ".py", ".csv"];

  // Sources are declared in YAML, which has no 1:1 file→node mapping (one file
  // can define many sources/tables). These extensions opt a file into the
  // cursor-aware source resolution in `getStartingNode`.
  private static readonly SOURCE_YAML_EXTENSIONS = [".yml", ".yaml"];

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

    return { message, type: "warning" };
  }

  private getStartingNode(
    resolvedSource?: ResolvedSourceTable,
  ): lineage.RenderArgs {
    const aiEnabled = true;
    const event = this.queryManifestService.getEventByCurrentProject();
    if (!event?.event) {
      this.dbtTerminal.info("Lineage:getStartingNode", "No event found");
      return {
        aiEnabled,
        missingLineageMessage: this.getMissingLineageMessage(),
      };
    }
    const { nodeMetaMap, functionMetaMap } = event.event;
    const editor = window.activeTextEditor;
    const tableName = this.getFilename();
    if (!editor || !tableName) {
      return {
        aiEnabled,
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
        return { node, aiEnabled };
      }
    }

    const _node = nodeMetaMap.lookupByBaseName(tableName);
    if (_node) {
      const key = _node.unique_id;
      const node = this.dbtLineageService.createTable(event.event, url, key);
      return { node, aiEnabled };
    }

    // Non-.py fallback: check if the active file is a dbt function.
    const fn = functionMetaMap.get(tableName);
    if (fn) {
      const node = this.dbtLineageService.createTable(
        event.event,
        url,
        fn.unique_id,
      );
      return { node, aiEnabled };
    }

    // Source YAML: a model/seed/function basename never matches, so by here the
    // active file may be a `sources:` definition. Root at the source the cursor
    // is on (or the file's only source table).
    if (LineagePanel.SOURCE_YAML_EXTENSIONS.includes(ext)) {
      const resolved =
        resolvedSource ?? this.resolveSourceStartingNode(event.event, editor);
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
          return { node, aiEnabled };
        }
      }
    }

    this.dbtTerminal.info(
      "Lineage:getStartingNode",
      `No node found for ${tableName}`,
    );
    return {
      aiEnabled,
      missingLineageMessage: this.getMissingLineageMessage(),
    };
  }

  // Resolve which source table the active YAML file should root the lineage at.
  // Returns the dbt unique_id key (`source.<pkg>.<source>.<table>`) and the
  // matched table. Prefers the table the cursor is on/under; falls back to the
  // file's single table, then to the first declared table for determinism.
  private resolveSourceStartingNode(
    event: Manifest,
    editor: TextEditor,
  ): ResolvedSourceTable | undefined {
    const { sourceMetaMap } = event;
    const matches = this.getSourceTablesForFile(
      sourceMetaMap,
      editor.document.uri.fsPath,
    );
    if (matches.length === 0) {
      return undefined;
    }
    if (matches.length === 1) {
      return matches[0];
    }
    return this.pickSourceTableByCursor(matches, editor) ?? matches[0];
  }

  // All source tables whose definition file is `filePath`. One YAML can declare
  // several sources, each with several tables, so this can return many matches.
  private getSourceTablesForFile(
    sourceMetaMap: SourceMetaMap,
    filePath: string,
  ): ResolvedSourceTable[] {
    const target = path.normalize(filePath);
    const matches: ResolvedSourceTable[] = [];
    for (const source of sourceMetaMap.values()) {
      for (const table of source.tables) {
        if (!table.path) {
          continue;
        }
        if (path.normalize(table.path) !== target) {
          continue;
        }
        matches.push({
          key: `${RESOURCE_TYPE_SOURCE}.${source.package_name}.${source.name}.${table.name}`,
          sourceName: source.name,
          table,
        });
      }
    }
    return matches;
  }

  // Of the candidate tables in the file, pick the one whose `name:` declaration
  // is the closest line at or above the cursor — i.e. the table the cursor sits
  // within. Returns undefined when the cursor is above every declaration.
  private pickSourceTableByCursor(
    matches: ResolvedSourceTable[],
    editor: TextEditor,
  ): ResolvedSourceTable | undefined {
    const cursorLine = editor.selection.active.line;
    const declLines = this.findSourceTableLines(editor.document);
    let best: ResolvedSourceTable | undefined;
    let bestLine = -1;
    for (const match of matches) {
      const declLine =
        declLines.get(`${match.sourceName}.${match.table.name}`) ?? -1;
      if (declLine >= 0 && declLine <= cursorLine && declLine > bestLine) {
        best = match;
        bestLine = declLine;
      }
    }
    return best;
  }

  // Line numbers of the `- name: <table>` declarations inside each source's
  // `tables:` block, keyed by `<source>.<table>`. Walks the YAML AST so a
  // source-level `name:`, a model name in a mixed-purpose schema file, or a
  // column that happens to share a table's name is never mistaken for a table
  // declaration — and the same table name under two sources in one file maps
  // to two distinct lines.
  private findSourceTableLines(document: TextDocument): Map<string, number> {
    const declLines = new Map<string, number>();
    const text = document.getText();
    let parsed;
    try {
      parsed = parseDocument(text);
    } catch {
      // Mid-edit YAML can be arbitrarily broken; fall back to "no
      // declarations found" and let the caller use its first-match default.
      return declLines;
    }
    const sources = parsed.get("sources");
    if (!isSeq(sources)) {
      return declLines;
    }
    for (const source of sources.items) {
      if (!isMap(source)) {
        continue;
      }
      const sourceName = source.get("name");
      const tables = source.get("tables");
      if (typeof sourceName !== "string" || !isSeq(tables)) {
        continue;
      }
      for (const table of tables.items) {
        if (!isMap(table)) {
          continue;
        }
        const nameNode = table.get("name", true);
        if (!isScalar(nameNode) || typeof nameNode.value !== "string") {
          continue;
        }
        const offset = nameNode.range?.[0];
        if (offset === undefined) {
          continue;
        }
        declLines.set(
          `${sourceName}.${nameNode.value}`,
          lineAtOffset(text, offset),
        );
      }
    }
    return declLines;
  }

  protected renderWebviewView(webview: Webview) {
    this._panel!.webview.html = super.getHtml(
      webview,
      this.extensionContext.extensionUri,
    );
  }
}
