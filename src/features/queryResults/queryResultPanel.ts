import { queryResults } from "@fusion-power-user/webview-contract";
import type {
  CancellationToken,
  Event,
  Uri,
  WebviewPanel,
  WebviewView,
  WebviewViewResolveContext,
} from "vscode";
import { commands, ViewColumn, window } from "vscode";

import type { ExecuteSQLResult, QueryExecution } from "../../core/dbtCommand";
import { ExecuteSQLError } from "../../core/dbtCommand";
import type { Log } from "../../core/log";
import { getFormattedDateTime } from "../../core/text";
import type { ExtensionContextStore } from "../../extensionContext";
import { publicationId } from "../../projects/manifest/manifest";
import {
  notifyError,
  notifyErrorWithoutProject,
} from "../../projects/output/notifications";
import type { CurrentProject } from "../../projects/project/currentProject";
import type { QueryPanelPayload } from "../../projects/project/projectSql";
import type { QueryManifestService } from "../../projects/project/queryManifestService";
import type {
  SharedStateEventEmitterProps,
  SharedStateService,
} from "../../projects/project/sharedStateService";
import { readSetting } from "../../settings";
import type { Handlers, MessageOf } from "../../webview/messageRouter";
import { type Page, PanelHost, postToWebview } from "../../webview/panelHost";
import { panelWebviewOptions } from "../../webview/panelHtml";
import { executeActiveEditorQuery } from "./activeEditorQuery";
import { QueryHistoryStore } from "./queryHistory";
import {
  activeEditorContext,
  failureOf,
  openSqlInEditor,
  QUERY_RESULTS_CSP,
  recordResult,
  resolveQueryProject,
  runOnQueryPanel,
  switchModelPreview,
  tabDataOf,
  updateQueryConfig,
} from "./queryPanelSupport";
import { QUERY_RESULTS_REPLAY } from "./replayRules";

type HostMessage = queryResults.HostMessage;
type PanelMessage = queryResults.PanelMessage;

const QueryPanelViewType = {
  DEFAULT: 0,
  OPEN_RESULTS_IN_TAB: 1,
  OPEN_RESULTS_FROM_HISTORY_BOOKMARKS: 2,
} as const;
type QueryPanelViewType =
  (typeof QueryPanelViewType)[keyof typeof QueryPanelViewType];

export class QueryResultPanel extends PanelHost<
  HostMessage,
  PanelMessage,
  queryResults.ResponseBodies
> {
  public static readonly viewType = "fusionPowerUser.PreviewResults";
  public override viewType = QueryResultPanel.viewType;
  protected readonly entry = "queryResults";
  protected readonly csp = QUERY_RESULTS_CSP;
  protected readonly guard = queryResults.isPanelMessage;
  protected override panelDescription = "Preview dbt SQL Results";
  private _queryTabData: queryResults.QueryTabData | undefined;
  private _bottomPanel: WebviewView | undefined;
  /** The tab data each results tab is bound to; the tab asks for it again after each rebuild. */
  private readonly tabDataByPage = new Map<Page, queryResults.QueryTabData>();

  private queryExecution: QueryExecution | undefined;
  /** Loading messages queued while the page is not ready; flushed when it reports ready. */
  private pendingMessages: HostMessage[] = [];

  protected override replayRules() {
    return QUERY_RESULTS_REPLAY;
  }

  // stored only for current session, if user reloads or opens new workspace, this will be reset
  declare protected extensionContext: ExtensionContextStore;
  declare protected dbtTerminal: Log;
  declare protected queryManifestService: QueryManifestService;
  private readonly currentProject: CurrentProject;
  private readonly history: QueryHistoryStore;

  public constructor({
    extensionContext,
    eventEmitterService,
    dbtTerminal,
    queryManifestService,
    currentProject,
    onDidRemoveProject,
  }: {
    extensionContext: ExtensionContextStore;
    eventEmitterService: SharedStateService;
    dbtTerminal: Log;
    queryManifestService: QueryManifestService;
    currentProject: CurrentProject;
    onDidRemoveProject: Event<Uri>;
  }) {
    super({
      extensionContext,
      emitterService: eventEmitterService,
      dbtTerminal,
      queryManifestService,
    });
    this.currentProject = currentProject;
    this.history = new QueryHistoryStore(dbtTerminal);
    this._disposables.push(
      onDidRemoveProject(() => {
        this.replay.clear();
        this.tabDataByPage.clear();
      }),
      // Resets the limit on editor change.
      window.onDidChangeActiveTextEditor(() =>
        this.sendUpdatedContextToWebview(),
      ),
    );
  }

  private async sendUpdatedContextToWebview() {
    const limit = readSetting("query.limit");
    const editor = window.activeTextEditor;
    await this.post({
      command: "getContext",
      limit,
      activeEditor: activeEditorContext(editor),
      publication: publicationId(this.queryManifestService.manifestFor()),
    });
  }

  private async createQueryResultsPanelVirtualDocument(editorName: string) {
    const webviewPanel = window.createWebviewPanel(
      QueryResultPanel.viewType,
      editorName + "_" + getFormattedDateTime(),
      {
        viewColumn: ViewColumn.Active,
      },
      {
        ...panelWebviewOptions(this.extensionContext.extensionUri),
      },
    );
    this._panel = webviewPanel;
    const subscription = webviewPanel.onDidDispose(() => {
      subscription.dispose();
      this.replay.delete(webviewPanel);
      this.tabDataByPage.delete(webviewPanel);
    });
    this.renderWebviewView(webviewPanel.webview);
    this.listen(webviewPanel);
    await this.whenReady(webviewPanel);
  }

  private updateViewTypeToWebview(viewType: QueryPanelViewType) {
    void this.post({
      command: "updateViewType",
      args: { body: { type: viewType } },
    });
  }

  protected override async onEvent({
    command,
    payload,
  }: SharedStateEventEmitterProps) {
    switch (command) {
      case "executeQuery":
        void this.executeQuery(payload as QueryPanelPayload);
        break;
      default:
        void super.onEvent({ command, payload });
    }
  }

  private openResultsInTab(queryTabData: queryResults.QueryTabData) {
    this._queryTabData = queryTabData;
    void this.createQueryResultsPanelVirtualDocument("Query results");
    this.updateViewTypeToWebview(QueryPanelViewType.OPEN_RESULTS_IN_TAB);
  }

  public override async resolveWebviewView(
    panel: WebviewView,
    _context: WebviewViewResolveContext,
    _token: CancellationToken,
  ) {
    this.updateViewTypeToWebview(QueryPanelViewType.DEFAULT);
    super.resolveWebviewView(panel, _context, _token);
    this._bottomPanel = panel;
    panel.title = "Query Results";
    _token.onCancellationRequested(async () => {
      await this.post({ command: "resetState" });
    });
  }

  private getProject(projectName?: string) {
    return resolveQueryProject(this.currentProject, projectName);
  }

  private async executeIncomingQuery(
    message: MessageOf<PanelMessage, "executeQuery">,
  ) {
    try {
      const project = await this.getProject(message.projectName);
      if (message.editorName) {
        await this.createQueryResultsPanelVirtualDocument(message.editorName);
      }
      this.updateViewTypeToWebview(
        QueryPanelViewType.OPEN_RESULTS_FROM_HISTORY_BOOKMARKS,
      );
      await runOnQueryPanel(project.queries, message);
    } catch (error) {
      void notifyErrorWithoutProject("Unable to execute query", error);
      this.dbtTerminal.error(
        "ExecuteSqlError",
        "Unable to execute query",
        error,
      );
    }
  }

  private viewResultSet({
    queryHistory,
    editorName,
  }: MessageOf<PanelMessage, "viewResultSet">) {
    this._queryTabData = tabDataOf(queryHistory);
    void this.createQueryResultsPanelVirtualDocument(
      (editorName ?? "") || "Custom query",
    );
    this.updateViewTypeToWebview(QueryPanelViewType.OPEN_RESULTS_IN_TAB);
  }

  /** Answers a page's request for its tab data; a rebuilt results tab asks again and gets the same data. */
  private sendQueryTabData(
    panel: WebviewView | WebviewPanel,
    syncRequestId: string | undefined,
  ) {
    const page = this.pageOf(panel);
    if (this._queryTabData && page !== "bottom") {
      this.tabDataByPage.set(page, this._queryTabData);
    }
    const body = this._queryTabData ?? this.tabDataByPage.get(page);
    void this.respondOn(panel).respond("getQueryTabData", syncRequestId, body);
    // A tab opened through "Open in Tab" reads its data once; later messages target the bottom panel.
    if (this._queryTabData) {
      this._panel = this._bottomPanel;
      this._queryTabData = undefined;
    }
  }

  /** One handler per query-results panel command sent by the page in `panel`. */
  protected override handlers(
    panel: WebviewView | WebviewPanel,
  ): Handlers<PanelMessage> {
    return {
      ...this.commonHandlers(panel),
      "webview:ready": () => this.onPageReady(panel),
      // The panel clears its history after a rendering error, then retries.
      clearQueryHistory: ({ syncRequestId }) => {
        this.history.clear();
        return this.respondOn(panel).respond(
          "clearQueryHistory",
          syncRequestId,
          {},
        );
      },
      openCodeInEditor: ({ code }) => openSqlInEditor(code),
      viewResultSet: (message) => this.viewResultSet(message),
      runAdhocQuery: () => openSqlInEditor(),
      executeQueryFromActiveWindow: ({ limit }) =>
        executeActiveEditorQuery(
          limit,
          async () =>
            (await this.currentProject.requireForActiveEditor())?.queries,
        ),
      executeQuery: (message) => this.executeIncomingQuery(message),
      switchPreview: (message) => switchModelPreview(message),
      getQueryHistory: () =>
        this.post({
          command: "queryHistory",
          args: { body: this.history.all() },
        }),
      getQueryTabData: ({ syncRequestId }) =>
        this.sendQueryTabData(panel, syncRequestId),
      getQueryPanelContext: () => this.sendUpdatedContextToWebview(),
      cancelQuery: async () => {
        void this.queryExecution?.cancel();
        await this.post({ command: "resetState" });
      },
      error: ({ text }) => notifyErrorWithoutProject(text),
      updateConfig: updateQueryConfig,
      "queryResultTab:render": ({ queryTabData }) =>
        this.openResultsInTab(queryTabData),
    };
  }

  /** Sends VSCode render loading command to webview */
  private async transmitLoading() {
    if (this._panel && this.isReady(this.pageOf(this._panel))) {
      await this.post({ command: "renderLoading" });
      return;
    }
    this.pendingMessages.push({ command: "renderLoading" });
  }

  /** Sends a result to the webview, converting the server's row arrays to the objects it expects. */
  private async transmitDataWrapper(
    result: ExecuteSQLResult,
    query: string,
    preview: queryResults.ModelPreview | undefined,
  ) {
    const { column_names: columnNames, column_types: columnTypes } =
      result.table;
    const rows = result.table.rows.map((row) =>
      Object.fromEntries(row.map((value, j) => [columnNames[j], value])),
    );
    const sent = {
      columnNames,
      // startSql already reports every column type as unknown.
      columnTypes,
      rows,
      raw_sql: query,
      compiled_sql: result.compiled_sql,
    };
    await this.post({ command: "renderQuery", ...sent, preview });
    return sent;
  }

  /** Runs a query transmitting appropriate notifications to webview */
  public async executeQuery({
    query,
    fn: queryExecutionPromise,
    projectName,
    preview,
  }: QueryPanelPayload) {
    const start = Date.now();
    //using id to focus on the webview is more reliable than using the view title
    await commands.executeCommand("fusionPowerUser.PreviewResults.focus");
    if (this._panel && this.isWebviewView(this._panel)) {
      this._panel.show(); // Show the view
    }
    void this.transmitLoading();
    try {
      const queryExecution = (this.queryExecution =
        await queryExecutionPromise);
      const output = await queryExecution.executeQuery();
      const result = await this.transmitDataWrapper(output, query, preview);
      recordResult({
        history: this.history,
        currentProject: this.currentProject,
        log: this.dbtTerminal,
        run: {
          result,
          projectName,
          query,
          start,
          modelName: output.modelName,
        },
      });
      return result;
    } catch (exc: unknown) {
      if (exc instanceof ExecuteSQLError) {
        void notifyError(this.currentProject.current, "Query failed", exc);
      }
      const failure = failureOf(exc, query);
      await this.post({
        command: "renderError",
        error: failure.error,
        raw_sql: query,
        compiled_sql: failure.compiledSql,
        preview,
      });
      return undefined;
    } finally {
      this.queryExecution = undefined;
      this._panel = this._bottomPanel;
    }
  }

  /** A page reports ready on first load and after VS Code rebuilds it; it gets back its last result. */
  private onPageReady(panel: WebviewView | WebviewPanel) {
    const replay = this.replay.messagesFor(this.pageOf(panel));
    this.onWebviewReady(panel);
    for (const message of replay) {
      void postToWebview(panel, message, this.dbtTerminal);
    }
  }

  protected override onWebviewReady(panel: WebviewView | WebviewPanel) {
    super.onWebviewReady(panel);

    if (!this._panel) {
      return;
    }

    while (this.pendingMessages.length) {
      const message = this.pendingMessages.pop();
      if (message) {
        void this.post(message);
      }
    }
  }
}
