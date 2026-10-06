import { queryResults } from "@fusion-power-user/webview-contract";
import {
  CancellationToken,
  commands,
  Event,
  Range,
  Uri,
  ViewColumn,
  WebviewPanel,
  WebviewView,
  WebviewViewResolveContext,
  window,
  workspace,
} from "vscode";

import * as path from "path";
import {
  ExecuteSQLError,
  ExecuteSQLResult,
  QueryExecution,
} from "../../core/dbtCommand";
import type { Log } from "../../core/log";
import { getFormattedDateTime, getStringSizeInMb } from "../../core/text";
import { ExtensionContextStore } from "../../extensionContext";
import { publicationId } from "../../projects/manifest";
import {
  notifyError,
  notifyErrorWithoutProject,
} from "../../projects/notifications";
import { activeModelUri } from "../../projects/previewUri";
import { QueryManifestService } from "../../projects/queryManifestService";
import {
  SharedStateEventEmitterProps,
  SharedStateService,
} from "../../projects/sharedStateService";
import { readSetting, writeSetting } from "../../settings";
import {
  dispatchMessage,
  Handlers,
  MessageOf,
} from "../../webview/messageRouter";
import { PanelHost } from "../../webview/panelHost";
import { panelWebviewOptions } from "../../webview/panelHtml";
import { PanelReplay } from "./panelReplay";

type HostMessage = queryResults.HostMessage;
type PanelMessage = queryResults.PanelMessage;
type QueryHistory = queryResults.QueryHistoryEntry;
type JsonObj = Record<string, unknown>;
/** A query results page: the bottom view, whichever `WebviewView` VS Code resolved last, or one results tab. */
type Page = "bottom" | WebviewPanel;

enum QueryPanelViewType {
  DEFAULT,
  OPEN_RESULTS_IN_TAB,
  OPEN_RESULTS_FROM_HISTORY_BOOKMARKS,
}

export class QueryResultPanel extends PanelHost {
  public static readonly viewType = "fusionPowerUser.PreviewResults";
  protected readonly entry = "queryResults";
  // Perspective fetches and compiles its .wasm and runs its engine in a worker started from a Blob.
  protected readonly csp = { wasm: true, connect: true, blobWorkers: true };
  protected override panelDescription = "Query results panel";
  private _queryTabData: unknown;
  private _bottomPanel: WebviewView | undefined;

  private queryExecution?: QueryExecution;
  private pendingMessages: HostMessage[] = [];
  private _replay?: PanelReplay<Page>;

  private get replay(): PanelReplay<Page> {
    return (this._replay ??= new PanelReplay<Page>());
  }

  // stored only for current session, if user reloads or opens new workspace, this will be reset
  private _queryHistory: QueryHistory[] = [];

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
    this._disposables.push(
      onDidRemoveProject(() => this.replay.clear()),
      window.onDidChangeActiveTextEditor(() => {
        // to reset the limit on editor change
        void this.sendUpdatedContextToWebview();
      }),
    );
  }

  /** Posts to the panel the host currently targets: the bottom view or an opened results tab. */
  private post(message: HostMessage): Thenable<boolean> | undefined {
    return this._panel && this.postTo(this._panel, message);
  }

  private pageOf(panel: WebviewView | WebviewPanel): Page {
    return this.isWebviewView(panel) ? "bottom" : panel;
  }

  private postTo(
    panel: WebviewView | WebviewPanel,
    message: HostMessage,
  ): Thenable<boolean> {
    this.replay.record(this.pageOf(panel), message);
    return panel.webview.postMessage(message);
  }

  private async sendUpdatedContextToWebview() {
    const perspectiveTheme = readSetting("queryResults.theme");
    const limit = readSetting("query.limit");
    const editor = window.activeTextEditor;
    await this.post({
      command: "getContext",
      limit,
      perspectiveTheme,
      activeEditor: {
        query: editor?.document.getText(),
        filepath: editor && activeModelUri(editor.document.uri).fsPath,
      },
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

  private openResultsInTab(queryTabData: unknown) {
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
      await this.transmitReset();
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

  private async getProject(projectName?: string) {
    if (!projectName) {
      return this.queryManifestService.getOrPickProjectFromWorkspace();
    }

    const project = this.queryManifestService.getProjectByName(projectName);
    if (!project) {
      throw new Error("Unable to find project to execute query");
    }
    return project;
  }

  private async executeIncomingQuery(
    message: MessageOf<PanelMessage, "executeQuery">,
  ) {
    try {
      const project = await this.getProject(message.projectName);
      if (!project) {
        throw new Error("Unable to find project to execute query");
      }
      if (message.editorName) {
        await this.createQueryResultsPanelVirtualDocument(message.editorName);
      }
      this.updateViewTypeToWebview(
        QueryPanelViewType.OPEN_RESULTS_FROM_HISTORY_BOOKMARKS,
      );
      if (message.limit) {
        await project.executeSQLWithLimitOnQueryPanel(
          message.query,
          "",
          message.limit,
        );
      } else {
        await project.executeSQLOnQueryPanel(message.query, "");
      }
      return;
    } catch (error) {
      void notifyErrorWithoutProject("Unable to execute query", error);
      this.dbtTerminal.error(
        "ExecuteSqlError",
        "Unable to execute query",
        error,
      );
    }
  }

  private async handleOpenCodeInEditor(code = "") {
    const document = await workspace.openTextDocument({
      language: "jinja-sql",
      content: code,
    });
    await window.showTextDocument(document);
  }

  private viewResultSet({
    queryHistory,
    editorName,
  }: MessageOf<PanelMessage, "viewResultSet">) {
    this._queryTabData = {
      queryResults: {
        data: queryHistory.data,
        columnNames: queryHistory.columnNames,
        columnTypes: queryHistory.columnTypes,
      },
      compiledCodeMarkup: queryHistory.compiledSql,
      rawSql: queryHistory.rawSql,
      elapsedTime: {
        queryExecutionInfo: { elapsedTime: queryHistory.duration },
      },
    };
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

  private updateConfig({
    limit,
    perspectiveTheme,
  }: MessageOf<PanelMessage, "updateConfig">) {
    if (limit !== undefined) {
      void writeSetting("query.limit", limit);
    }
    if (perspectiveTheme !== undefined) {
      void writeSetting("queryResults.theme", perspectiveTheme);
    }
  }

  /** One handler per query-results panel command sent by the page in `panel`. */
  private handlers(panel: WebviewView | WebviewPanel): Handlers<PanelMessage> {
    return {
      ...this.commonHandlers(),
      "webview:ready": () => this.onPageReady(panel),
      // The panel clears its history after a rendering error, then retries.
      clearQueryHistory: ({ syncRequestId }) => {
        this._queryHistory = [];
        return this.post({
          command: "response",
          args: { syncRequestId, body: {}, status: true },
        });
      },
      openCodeInEditor: ({ code }) => this.handleOpenCodeInEditor(code),
      viewResultSet: (message) => this.viewResultSet(message),
      runAdhocQuery: () => this.handleOpenCodeInEditor(),
      executeQueryFromActiveWindow: (message) =>
        this.executeQueryFromActiveWindow(message),
      executeQuery: (message) => this.executeIncomingQuery(message),
      getQueryHistory: () =>
        this.post({
          command: "queryHistory",
          args: { body: this._queryHistory },
        }),
      getQueryTabData: ({ syncRequestId }) =>
        this.sendQueryTabData(panel, syncRequestId),
      getQueryPanelContext: () => this.sendUpdatedContextToWebview(),
      cancelQuery: async () => {
        void this.queryExecution?.cancel();
        await this.transmitReset();
      },
      error: ({ text }) => notifyErrorWithoutProject(text),
      updateConfig: (message) => this.updateConfig(message),
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

  private async executeQueryFromActiveWindow({
    limit,
  }: MessageOf<PanelMessage, "executeQueryFromActiveWindow">) {
    const activeEditor = window.activeTextEditor;
    if (!activeEditor) {
      void notifyErrorWithoutProject("No active editor found");
      return;
    }
    const project = await this.getProject();
    if (!project) {
      void notifyErrorWithoutProject(
        "Unable to find dbt project for executing query",
      );
      return;
    }
    const modelName = path.basename(activeEditor.document.uri.fsPath, ".sql");
    let query = activeEditor.document.getText();
    const selection = activeEditor.selection;
    if (selection && !selection.isEmpty) {
      const selectionRange = new Range(
        selection.start.line,
        selection.start.character,
        selection.end.line,
        selection.end.character,
      );
      query = activeEditor.document.getText(selectionRange);
    }
    await project.executeSQLWithLimitOnQueryPanel(query, modelName, limit);
  }

  /** Sends query result data to webview */
  private async transmitData(
    columnNames: string[],
    columnTypes: (string | null)[],
    rows: JsonObj[],
    raw_sql: string,
    compiled_sql: string,
  ) {
    const result = {
      columnNames,
      columnTypes,
      rows,
      raw_sql,
      compiled_sql,
    };
    await this.post({ command: "renderQuery", ...result });
    return result;
  }

  /** Sends error result data to webview */
  private async transmitError(
    error: MessageOf<HostMessage, "renderError">["error"],
    raw_sql: string,
    compiled_sql: string,
  ) {
    await this.post({ command: "renderError", error, raw_sql, compiled_sql });
  }

  /** Sends VSCode render loading command to webview */
  private async transmitLoading() {
    if (this._panel && this.isWebviewReady) {
      await this.post({ command: "renderLoading" });
      return;
    }
    this.pendingMessages.push({ command: "renderLoading" });
  }

  /** Sends VSCode clear state command */
  private async transmitReset() {
    await this.post({ command: "resetState" });
  }

  /** A wrapper for {@link transmitData} which converts server
   * results interface ({@link ExecuteSQLResult}) to what the webview expects */
  private async transmitDataWrapper(result: ExecuteSQLResult, query: string) {
    const rows: JsonObj[] = new Array(result.table.rows.length);
    // Convert compressed array format to dict[] - optimized version
    for (let i = 0; i < result.table.rows.length; i++) {
      const row: JsonObj = {};
      const currentRow = result.table.rows[i];
      for (let j = 0; j < currentRow.length; j++) {
        row[result.table.column_names[j]] = currentRow[j];
      }
      rows[i] = row;
    }
    return await this.transmitData(
      result.table.column_names,
      // executeSql already reports every column type as unknown.
      result.table.column_types,
      rows,
      query,
      result.compiled_sql,
    );
  }

  private updateQueryHistory(
    result: {
      columnNames: string[];
      columnTypes: (string | null)[];
      rows: JsonObj[];
      raw_sql: string;
      compiled_sql: string;
    },
    projectName: string,
    query: string,
    duration: number,
    modelName: string,
  ) {
    const project = projectName
      ? this.queryManifestService.getProjectByName(projectName) // for queries executed from history and bookmarks tab
      : this.queryManifestService.getProject(); // queries executed from main window
    if (!project) {
      this.dbtTerminal.debug(
        "updateQueryHistory",
        "skipping query history update, no project found, may be executed from query history",
      );
      return;
    }
    const queryHistoryCurrentSize = getStringSizeInMb(
      JSON.stringify(this._queryHistory),
    );
    // if current history size > 3MB, remove the oldest entry
    if (queryHistoryCurrentSize > 3) {
      this._queryHistory.pop();
      this.dbtTerminal.info(
        "updateQueryHistory",
        "Query history size exceeded 3MB, cleared oldest entry",
      );
    }
    this._queryHistory.unshift({
      rawSql: query,
      compiledSql: result.compiled_sql,
      timestamp: Date.now(),
      duration,
      adapter: project.getAdapterType(),
      projectName: project.getProjectName(),
      data: result.rows,
      columnNames: result.columnNames,
      columnTypes: result.columnTypes,
      modelName,
    });
    this._queryHistory = this._queryHistory.splice(0, 10);
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
      this.updateQueryHistory(
        result,
        projectName,
        query,
        Date.now() - start,
        output.modelName,
      );
      return result;
    } catch (exc: any) {
      if (exc instanceof ExecuteSQLError) {
        void notifyError(
          this.queryManifestService.getProject(),
          "Query failed",
          exc,
        );
        await this.transmitError(
          {
            code: -1,
            message: exc.message,
            data: JSON.stringify(exc.stack, null, 2),
          },
          query,
          exc.compiled_sql,
        );
        return;
      }
      await this.transmitError(
        { code: -1, message: `${exc}`, data: {} },
        query,
        query,
      );
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
      void panel.webview.postMessage(message);
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
