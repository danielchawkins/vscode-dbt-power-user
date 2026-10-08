import { queryResults } from "@fusion-power-user/webview-contract";
import {
  CancellationToken,
  commands,
  Event,
  Uri,
  ViewColumn,
  WebviewPanel,
  WebviewView,
  WebviewViewResolveContext,
  window,
} from "vscode";

import {
  ExecuteSQLError,
  ExecuteSQLResult,
  QueryExecution,
} from "../../core/dbtCommand";
import type { Log } from "../../core/log";
import { getFormattedDateTime } from "../../core/text";
import { ExtensionContextStore } from "../../extensionContext";
import { publicationId } from "../../projects/manifest";
import {
  notifyError,
  notifyErrorWithoutProject,
} from "../../projects/notifications";
import { QueryManifestService } from "../../projects/queryManifestService";
import {
  SharedStateEventEmitterProps,
  SharedStateService,
} from "../../projects/sharedStateService";
import { readSetting } from "../../settings";
import {
  dispatchMessage,
  Handlers,
  MessageOf,
} from "../../webview/messageRouter";
import { PanelHost, postToWebview } from "../../webview/panelHost";
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
  tabDataOf,
  updateQueryConfig,
} from "./queryPanelSupport";
import { QUERY_RESULTS_REPLAY } from "./replayRules";

type HostMessage = queryResults.HostMessage;
type PanelMessage = queryResults.PanelMessage;

enum QueryPanelViewType {
  DEFAULT,
  OPEN_RESULTS_IN_TAB,
  OPEN_RESULTS_FROM_HISTORY_BOOKMARKS,
}

export class QueryResultPanel extends PanelHost<HostMessage> {
  public static readonly viewType = "fusionPowerUser.PreviewResults";
  protected readonly entry = "queryResults";
  protected readonly csp = QUERY_RESULTS_CSP;
  protected override panelDescription = "Query results panel";
  private _queryTabData: Record<string, unknown> | undefined;
  private _bottomPanel: WebviewView | undefined;

  private queryExecution: QueryExecution | undefined;
  private pendingMessages: HostMessage[] = [];

  protected override replayRules() {
    return QUERY_RESULTS_REPLAY;
  }

  // stored only for current session, if user reloads or opens new workspace, this will be reset
  private readonly history: QueryHistoryStore;

  public constructor(
    protected override extensionContext: ExtensionContextStore,
    eventEmitterService: SharedStateService,
    protected override dbtTerminal: Log,
    protected override queryManifestService: QueryManifestService,
    onDidRemoveProject: Event<Uri>,
  ) {
    super(
      extensionContext,
      eventEmitterService,
      dbtTerminal,
      queryManifestService,
    );
    this.history = new QueryHistoryStore(dbtTerminal);
    this._disposables.push(
      onDidRemoveProject(() => this.replay.clear()),
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
    this.isWebviewReady = false;
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
    this._webview = webviewPanel.webview;
    const subscription = webviewPanel.onDidDispose(() => {
      subscription.dispose();
      this.replay.delete(webviewPanel);
    });
    this.renderWebviewView(webviewPanel.webview);
    this.setupWebviewHooks();
    await this.checkIfWebviewReady();
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
        void this.executeQuery(
          payload.query as string,
          payload.fn as Promise<QueryExecution>,
          payload.projectName as string,
        );
        break;
      default:
        void super.onEvent({ command, payload });
    }
  }

  private openResultsInTab(queryTabData: Record<string, unknown>) {
    this._queryTabData = queryTabData;
    void this.createQueryResultsPanelVirtualDocument("Query results");
    this.updateViewTypeToWebview(QueryPanelViewType.OPEN_RESULTS_IN_TAB);
  }

  public override async resolveWebviewView(
    panel: WebviewView,
    _context: WebviewViewResolveContext,
    _token: CancellationToken,
  ) {
    this.beginWebviewResolve();
    this.updateViewTypeToWebview(QueryPanelViewType.DEFAULT);
    this._panel = panel;
    this._bottomPanel = panel;
    this._webview = panel.webview;
    this.bindWebviewOptions();
    this.renderWebviewView(panel.webview);
    this.setupWebviewHooks();
    _token.onCancellationRequested(async () => {
      await this.post({ command: "resetState" });
    });
  }

  /** Sets the page's title, description and webview options. */
  private bindWebviewOptions() {
    if (!this._panel) {
      return;
    }
    this._panel.title = "Query Results";
    if (this.isWebviewView(this._panel)) {
      this._panel.description = "Preview dbt SQL Results";
    }
    this._panel.webview.options = panelWebviewOptions(
      this.extensionContext.extensionUri,
    );
  }

  private getProject(projectName?: string) {
    return resolveQueryProject(this.queryManifestService, projectName);
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
      await runOnQueryPanel(project, message);
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
      editorName || "Custom query",
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
      this.replay.setTabData(page, this._queryTabData);
    }
    const body = this._queryTabData ?? this.replay.tabDataFor(page);
    void this.postTo(panel, {
      command: "response",
      args: { syncRequestId, body, status: true },
    });
    // A tab opened through "Open in Tab" reads its data once; later messages target the bottom panel.
    if (this._queryTabData) {
      this._panel = this._bottomPanel;
      this._queryTabData = undefined;
    }
  }

  /** One handler per query-results panel command sent by the page in `panel`. */
  private handlers(panel: WebviewView | WebviewPanel): Handlers<PanelMessage> {
    return {
      ...this.commonHandlers(),
      "webview:ready": () => this.onPageReady(panel),
      // The panel clears its history after a rendering error, then retries.
      clearQueryHistory: ({ syncRequestId }) => {
        this.history.clear();
        return this.post({
          command: "response",
          args: { syncRequestId, body: {}, status: true },
        });
      },
      openCodeInEditor: ({ code }) => openSqlInEditor(code),
      viewResultSet: (message) => this.viewResultSet(message),
      runAdhocQuery: () => openSqlInEditor(),
      executeQueryFromActiveWindow: ({ limit }) =>
        executeActiveEditorQuery(limit, () =>
          this.queryManifestService.getOrPickProjectFromWorkspace(),
        ),
      executeQuery: (message) => this.executeIncomingQuery(message),
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

  protected async handleCommand(
    message: unknown,
    panel: WebviewView | WebviewPanel = this._panel!,
  ): Promise<void> {
    await dispatchMessage(
      QueryResultPanel.viewType,
      message,
      queryResults.isPanelMessage,
      this.handlers(panel),
      {
        log: this.dbtTerminal,
        reply: (response) => this.postTo(panel, response),
      },
    );
  }

  /** Primary interface for WebviewView inbound communication; a results tab's subscription ends with the tab. */
  private setupWebviewHooks() {
    const panel = this._panel!;
    const subscription = panel.webview.onDidReceiveMessage((message: unknown) =>
      this.handleCommand(message, panel),
    );
    if (this.isWebviewView(panel)) {
      this._disposables.push(subscription);
    } else {
      panel.onDidDispose(() => subscription.dispose());
    }
  }

  /** Sends VSCode render loading command to webview */
  private async transmitLoading() {
    if (this._panel && this.isWebviewReady) {
      await this.post({ command: "renderLoading" });
      return;
    }
    this.pendingMessages.push({ command: "renderLoading" });
  }

  /** Sends a result to the webview, converting the server's row arrays to the objects it expects. */
  private async transmitDataWrapper(result: ExecuteSQLResult, query: string) {
    const { column_names: columnNames, column_types: columnTypes } =
      result.table;
    const rows = result.table.rows.map((row) =>
      Object.fromEntries(row.map((value, j) => [columnNames[j], value])),
    );
    const sent = {
      columnNames,
      // executeSql already reports every column type as unknown.
      columnTypes,
      rows,
      raw_sql: query,
      compiled_sql: result.compiled_sql,
    };
    await this.post({ command: "renderQuery", ...sent });
    return sent;
  }

  /** Runs a query transmitting appropriate notifications to webview */
  public async executeQuery(
    query: string,
    queryExecutionPromise: Promise<QueryExecution>,
    projectName: string,
  ) {
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
      const result = await this.transmitDataWrapper(output, query);
      recordResult(this.history, this.queryManifestService, this.dbtTerminal, {
        result,
        projectName,
        query,
        start,
        modelName: output.modelName,
      });
      return result;
    } catch (exc: unknown) {
      if (exc instanceof ExecuteSQLError) {
        void notifyError(
          this.queryManifestService.getProject(),
          "Query failed",
          exc,
        );
      }
      const failure = failureOf(exc, query);
      await this.post({
        command: "renderError",
        error: failure.error,
        raw_sql: query,
        compiled_sql: failure.compiledSql,
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
    this.onWebviewReady();
    for (const message of replay) {
      void postToWebview(panel, message);
    }
  }

  protected override onWebviewReady() {
    super.onWebviewReady();

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
