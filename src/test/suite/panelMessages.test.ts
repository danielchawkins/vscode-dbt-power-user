import {
  documentationEditor,
  lineage,
  queryResults,
} from "@fusion-power-user/webview-contract";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, EventEmitter, Uri, window, workspace } from "vscode";
import { ColumnProposalRequests } from "../../features/docs/columnProposals";
import type * as panelHtmlModule from "../../webview/panelHtml";
import {
  docsEditPanel,
  fakeView,
  isPageReady,
  lineagePanel,
  openPage,
  queryResultPanel,
} from "../panelHarness";
import { silentLog } from "../testLog";
import { isDocumentationEditorHostMessage } from "./hostMessageOracle";

vi.mock("../../webview/panelHtml", async (importOriginal) => ({
  ...(await importOriginal<typeof panelHtmlModule>()),
  panelHtml: () => "<html>panel</html>",
}));

/** One row: sends a valid message to a fresh panel and asserts its effect. */
type Row = () => Promise<void>;

/** The `response` a panel posts to answer the request `syncRequestId`. */
const response = (syncRequestId: string, body: unknown) => ({
  command: "response",
  args: { syncRequestId, body, status: true },
});

/** The table must have one row per command of the contract, and no others. */
function expectRowsCover(rows: Record<string, Row>, contract: string[]) {
  const missing = contract.filter((command) => !(command in rows));
  expect(missing, "panelCommands entries with no row").toEqual([]);
  expect(Object.keys(rows).sort()).toEqual(contract.toSorted());
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  window.activeTextEditor = undefined;
});

/** A lineage panel built as the extension builds it, with stubbed services; `postMessage` collects what it posts. */
function lineageHarness() {
  const dbtLineageService = {
    columnsNeedStrict: vi.fn().mockReturnValue(undefined),
    getChildTables: vi.fn().mockReturnValue([{ table: "model.p.b" }]),
    getParentTables: vi.fn().mockReturnValue([{ table: "model.p.z" }]),
    getTableEdges: vi
      .fn()
      .mockReturnValue({ edges: [["model.p.z", "model.p.a"]] }),
    getConnectedColumns: vi
      .fn()
      .mockResolvedValue({ kind: "lineage", columnLineage: [] }),
  };
  const queryManifestService = {
    getEventByCurrentProject: vi.fn().mockReturnValue(undefined),
    getProject: vi.fn().mockReturnValue(undefined),
    manifestFor: vi.fn().mockReturnValue(undefined),
  };
  const globalState = new Map<string, unknown>();
  const extensionContext = {
    extensionUri: Uri.file("/ext"),
    getFromGlobalState: (key: string) => globalState.get(key),
    setToGlobalState: (key: string, value: unknown) =>
      globalState.set(key, value),
  };
  const panel = lineagePanel(silentLog(), {
    extensionContext,
    dbtLineageService,
    queryManifestService,
  }) as any;
  // `details` is a getter that builds a LineageDetails on each read; shadow it with one stub.
  Object.defineProperty(panel, "details", {
    value: {
      getColumns: vi.fn().mockResolvedValue({ id: "model.p.a", columns: [] }),
      getExposureDetails: vi.fn().mockResolvedValue({ name: "exp" }),
      getFunctionDetails: vi.fn().mockResolvedValue({ name: "fn" }),
      getRelationships: vi.fn().mockReturnValue({ parents: [] }),
    },
  });
  const page = openPage(panel, fakeView(), false);
  return {
    panel,
    view: page.page,
    postMessage: page.page.webview.postMessage,
    globalState,
    send: page.send,
  };
}

describe("lineage panel messages", () => {
  const rows: Record<string, Row> = {
    "webview:ready": async () => {
      const h = lineageHarness();
      await h.send({ command: "webview:ready" });
      expect(isPageReady(h.panel, h.view)).toBe(true);
      expect(h.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: "render" }),
      );
    },
    openProblemsTab: async () => {
      const h = lineageHarness();
      await h.send({ command: "openProblemsTab" });
      expect(commands.executeCommand).toHaveBeenCalledWith(
        "workbench.action.problems.focus",
      );
    },
    runNoticeAction: async () => {
      const h = lineageHarness();
      const projectRoot = Uri.file("/p");
      h.panel.queryManifestService.getProject = () => ({ projectRoot });
      await h.send({ command: "runNoticeAction", action: "useStrictAnalysis" });
      expect(commands.executeCommand).toHaveBeenCalledWith(
        "fusionPowerUser.useStrictAnalysis",
        projectRoot,
      );
    },
    init: async () => {
      const h = lineageHarness();
      await h.send({ command: "init" });
      expect(h.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: "render" }),
      );
    },
    openFile: async () => {
      const h = lineageHarness();
      await h.send({
        command: "openFile",
        args: { params: { url: "/p/models/a.sql" } },
      });
      expect(commands.executeCommand).toHaveBeenCalledWith(
        "vscode.open",
        Uri.file("/p/models/a.sql"),
        { preview: false, preserveFocus: true },
      );
    },
    childTables: async () => {
      const h = lineageHarness();
      await h.send({
        command: "childTables",
        args: { params: { table: "model.p.a" } },
        syncRequestId: "c1",
      });
      expect(h.panel.dbtLineageService.getChildTables).toHaveBeenCalledWith({
        table: "model.p.a",
      });
      expect(h.postMessage).toHaveBeenCalledWith(
        response("c1", [{ table: "model.p.b" }]),
      );
    },
    parentTables: async () => {
      const h = lineageHarness();
      await h.send({
        command: "parentTables",
        args: { params: { table: "model.p.a" } },
        syncRequestId: "p1",
      });
      expect(h.panel.dbtLineageService.getParentTables).toHaveBeenCalledWith({
        table: "model.p.a",
      });
      expect(h.postMessage).toHaveBeenCalledWith(
        response("p1", [{ table: "model.p.z" }]),
      );
    },
    tableEdges: async () => {
      const h = lineageHarness();
      await h.send({
        command: "tableEdges",
        args: { params: { tables: ["model.p.a", "model.p.z"] } },
        syncRequestId: "e1",
      });
      expect(h.panel.dbtLineageService.getTableEdges).toHaveBeenCalledWith({
        tables: ["model.p.a", "model.p.z"],
      });
      expect(h.postMessage).toHaveBeenCalledWith(
        response("e1", { edges: [["model.p.z", "model.p.a"]] }),
      );
    },
    getColumns: async () => {
      const h = lineageHarness();
      await h.send({
        command: "getColumns",
        args: { params: { table: "model.p.a" } },
        syncRequestId: "g1",
      });
      expect(h.panel.details.getColumns).toHaveBeenCalledWith({
        table: "model.p.a",
        refresh: false,
      });
      expect(h.postMessage).toHaveBeenCalledWith(
        response("g1", { id: "model.p.a", columns: [] }),
      );
    },
    getExposureDetails: async () => {
      const h = lineageHarness();
      await h.send({
        command: "getExposureDetails",
        args: { params: { name: "exp" } },
        syncRequestId: "e1",
      });
      expect(h.panel.details.getExposureDetails).toHaveBeenCalledWith({
        name: "exp",
      });
      expect(h.postMessage).toHaveBeenCalledWith(
        response("e1", { name: "exp" }),
      );
    },
    getFunctionDetails: async () => {
      const h = lineageHarness();
      await h.send({
        command: "getFunctionDetails",
        args: { params: { name: "fn" } },
        syncRequestId: "f1",
      });
      expect(h.panel.details.getFunctionDetails).toHaveBeenCalledWith({
        name: "fn",
      });
      expect(h.postMessage).toHaveBeenCalledWith(
        response("f1", { name: "fn" }),
      );
    },
    getRelationships: async () => {
      const h = lineageHarness();
      await h.send({
        command: "getRelationships",
        args: { params: { includeSources: true } },
        syncRequestId: "r1",
      });
      expect(h.panel.details.getRelationships).toHaveBeenCalledWith({
        includeSources: true,
      });
      expect(h.postMessage).toHaveBeenCalledWith(
        response("r1", { parents: [] }),
      );
    },
    getConnectedColumns: async () => {
      const h = lineageHarness();
      const targets = [["model.p.a", "id"]];
      await h.send({
        command: "getConnectedColumns",
        args: { params: { targets, upstreamExpansion: true } },
        syncRequestId: "k1",
      });
      expect(
        h.panel.dbtLineageService.getConnectedColumns,
      ).toHaveBeenCalledWith(
        { targets, upstreamExpansion: true },
        expect.anything(),
      );
      expect(h.postMessage).toHaveBeenCalledWith(
        response("k1", { column_lineage: [] }),
      );
    },
    getLineageSettings: async () => {
      const h = lineageHarness();
      await h.send({ command: "getLineageSettings", syncRequestId: "l1" });
      expect(h.postMessage).toHaveBeenCalledWith(
        response(
          "l1",
          expect.objectContaining({
            showSelectEdges: true,
            showNonSelectEdges: false,
          }),
        ),
      );
    },
    persistLineageSettings: async () => {
      const h = lineageHarness();
      await h.send({
        command: "persistLineageSettings",
        args: { params: { defaultExpansion: 3, connections: "both" } },
        syncRequestId: "s1",
      });
      expect(workspace.getConfiguration().update).toHaveBeenCalledWith(
        "lineage.defaultExpansion",
        3,
      );
      expect([...h.globalState.values()]).toContainEqual(
        expect.objectContaining({ connections: "both" }),
      );
      expect(h.postMessage).toHaveBeenCalledWith(response("s1", { ok: true }));
    },
  };

  it("has a row for every panelCommands entry", () => {
    expectRowsCover(rows, lineage.panelCommands);
  });

  it.each(Object.entries(rows))("%s", async (_command, row) => {
    await row();
  });
});

/** A query results panel resolved on its bottom view and, unless `ready` is false, reporting ready; `view` is that page. */
function queryHarness(ready = true) {
  const project = {
    getAdapterType: () => "duckdb",
    getProjectName: () => "jaffle",
    queries: {
      executeSQLOnQueryPanel: vi.fn(),
      executeSQLWithLimitOnQueryPanel: vi.fn(),
    },
  };
  const service = {
    manifestFor: () => undefined,
    getProject: () => project,
    getProjectByName: () => project,
    getOrPickProjectFromWorkspace: async () => project,
  };
  const panel = queryResultPanel(silentLog(), service) as any;
  const page = openPage(panel, fakeView(), ready);
  return {
    panel,
    view: page.page,
    project,
    send: page.send,
  };
}

/** The `OPEN_RESULTS_IN_TAB` member of the panel's view-type enum, which is not exported. */
const OPEN_RESULTS_IN_TAB = 1;

const historyEntry = {
  rawSql: "select 1",
  compiledSql: "select 1",
  timestamp: 1,
  duration: 1,
  adapter: "duckdb",
  projectName: "jaffle",
  columnNames: [],
  columnTypes: [],
  modelName: "orders",
};

describe("query results panel messages", () => {
  beforeEach(() => {
    // The mock has no showTextDocument; the rows that open an editor need one.
    Object.assign(window, { showTextDocument: vi.fn() });
  });

  afterEach(() => {
    delete (window as { showTextDocument?: unknown }).showTextDocument;
  });

  const rows: Record<string, Row> = {
    "webview:ready": async () => {
      const h = queryHarness(false);
      await h.send({ command: "webview:ready" });
      expect(isPageReady(h.panel, h.view)).toBe(true);
    },
    error: async () => {
      const h = queryHarness();
      await h.send({ command: "error", text: "boom" });
      expect(vi.mocked(window.showErrorMessage).mock.calls[0][0]).toContain(
        "boom",
      );
    },
    updateConfig: async () => {
      const h = queryHarness();
      await h.send({ command: "updateConfig", limit: 50 });
      expect(workspace.getConfiguration().update).toHaveBeenCalledWith(
        "query.limit",
        50,
      );
    },
    cancelQuery: async () => {
      const h = queryHarness();
      const cancel = vi.fn();
      h.panel.queryExecution = { cancel };
      await h.send({ command: "cancelQuery" });
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(h.view.webview.postMessage).toHaveBeenCalledWith({
        command: "resetState",
      });
    },
    getQueryPanelContext: async () => {
      const h = queryHarness();
      await h.send({ command: "getQueryPanelContext" });
      expect(h.view.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: "getContext" }),
      );
    },
    getQueryHistory: async () => {
      const h = queryHarness();
      await h.send({ command: "getQueryHistory" });
      expect(h.view.webview.postMessage).toHaveBeenCalledWith({
        command: "queryHistory",
        args: { body: [] },
      });
    },
    executeQuery: async () => {
      const h = queryHarness();
      await h.send({
        command: "executeQuery",
        query: "select 1",
        projectName: "jaffle",
      });
      expect(h.project.queries.executeSQLOnQueryPanel).toHaveBeenCalledWith(
        "select 1",
        "",
      );
    },
    executeQueryFromActiveWindow: async () => {
      const h = queryHarness();
      window.activeTextEditor = {
        document: {
          uri: Uri.file("/p/models/orders.sql"),
          getText: () => "select 2",
        },
        selection: { isEmpty: true },
      } as never;
      await h.send({ command: "executeQueryFromActiveWindow", limit: 10 });
      expect(
        h.project.queries.executeSQLWithLimitOnQueryPanel,
      ).toHaveBeenCalledWith("select 2", "orders", 10);
    },
    switchPreview: async () => {
      const h = queryHarness();
      await h.send({
        command: "switchPreview",
        mode: "materialized",
        model: "/p/models/orders.sql",
      });
      expect(commands.executeCommand).toHaveBeenCalledWith(
        "fusionPowerUser.previewMaterialized",
        { url: "/p/models/orders.sql" },
      );
    },
    getQueryTabData: async () => {
      const h = queryHarness();
      h.panel._queryTabData = { n: 1 };
      await h.send({ command: "getQueryTabData", syncRequestId: "t1" });
      expect(h.view.webview.postMessage).toHaveBeenCalledWith(
        response("t1", { n: 1 }),
      );
    },
    runAdhocQuery: async () => {
      const h = queryHarness();
      const document = { uri: Uri.file("/untitled.sql") };
      vi.mocked(workspace.openTextDocument).mockResolvedValueOnce(
        document as never,
      );
      await h.send({ command: "runAdhocQuery" });
      expect(workspace.openTextDocument).toHaveBeenCalledWith({
        language: "jinja-sql",
        content: "",
      });
      expect(window.showTextDocument).toHaveBeenCalledWith(document);
    },
    openCodeInEditor: async () => {
      const h = queryHarness();
      const document = { uri: Uri.file("/untitled.sql") };
      vi.mocked(workspace.openTextDocument).mockResolvedValueOnce(
        document as never,
      );
      await h.send({ command: "openCodeInEditor", code: "select 3" });
      expect(workspace.openTextDocument).toHaveBeenCalledWith({
        language: "jinja-sql",
        content: "select 3",
      });
      expect(window.showTextDocument).toHaveBeenCalledWith(document);
    },
    viewResultSet: async () => {
      const h = queryHarness();
      const open = vi
        .spyOn(h.panel, "createQueryResultsPanelVirtualDocument")
        .mockResolvedValue(undefined);
      await h.send({
        command: "viewResultSet",
        queryHistory: historyEntry,
        editorName: "Mine",
      });
      expect(open).toHaveBeenCalledWith("Mine");
      expect(h.view.webview.postMessage).toHaveBeenCalledWith({
        command: "updateViewType",
        args: { body: { type: OPEN_RESULTS_IN_TAB } },
      });
    },
    clearQueryHistory: async () => {
      const h = queryHarness();
      const clear = vi.spyOn(h.panel.history, "clear");
      await h.send({
        command: "clearQueryHistory",
        syncRequestId: "c1",
        error: "boom",
      });
      expect(clear).toHaveBeenCalledTimes(1);
      expect(h.view.webview.postMessage).toHaveBeenCalledWith(
        response("c1", {}),
      );
    },
    "queryResultTab:render": async () => {
      const h = queryHarness();
      const open = vi
        .spyOn(h.panel, "createQueryResultsPanelVirtualDocument")
        .mockResolvedValue(undefined);
      await h.send({
        command: "queryResultTab:render",
        queryTabData: { n: 1 },
      });
      expect(open).toHaveBeenCalledWith("Query results");
      expect(h.panel._queryTabData).toEqual({ n: 1 });
      expect(h.view.webview.postMessage).toHaveBeenCalledWith({
        command: "updateViewType",
        args: { body: { type: OPEN_RESULTS_IN_TAB } },
      });
    },
  };

  it("has a row for every panelCommands entry", () => {
    expectRowsCover(rows, queryResults.panelCommands);
  });

  it.each(Object.entries(rows))("%s", async (_command, row) => {
    await row();
  });
});

/** A documentation editor on `/p/models/orders.sql`; `postMessage` collects what it posts. */
function docsHarness() {
  const docs = {
    name: "orders",
    description: "saved",
    columns: [{ name: "id", type: "int" }],
    filePath: "/p/models/orders.sql",
  };
  const payload = {
    kind: "types",
    model: "/p/models/orders.sql",
    proposals: [{ column: "id", type: "integer", change: "fill" }],
    notFound: [],
  };
  const columnProposals = {
    propose: vi.fn(
      async (
        _kind: string,
        _target: unknown,
      ): Promise<typeof payload | undefined> => payload,
    ),
  };
  const project = {
    projectRoot: Uri.file("/p"),
    getProjectName: () => "jaffle",
    getAdapterType: () => "duckdb",
    queries: {
      getColumnValues: vi.fn(async () => ["a", "b"]),
      getColumnsOfSource: vi.fn(async () => [{ column: "id" }]),
      getColumnsOfModel: vi.fn(async () => [
        { column: "id", dtype: "INTEGER" },
      ]),
    },
  };
  const projects = {
    onDidChangeManifest: new EventEmitter<unknown>().event,
    onDidRemoveProject: new EventEmitter<Uri>().event,
    get: vi.fn(() => project),
  } as any;
  const docGenService = {
    getUncompiledDocumentationForCurrentActiveFile: vi.fn(async () => ({
      documentation: docs,
    })),
    getUncompiledDocumentation: vi.fn(async (_filePath?: string) => ({
      documentation: docs,
    })),
  };
  const dbtTestService = {
    getTestsForCurrentModel: vi.fn(async () => []),
    getUnitTestsForCurrentModel: vi.fn(async () => []),
    getConfigByTest: vi.fn(() => ({ severity: "warn" })),
  };
  const queryManifestService = {
    manifestFor: () => undefined,
    getSourcesInProject: vi.fn(() => ["raw.orders"]),
    getModelsInProject: vi.fn(() => ["orders"]),
  };
  const columnProposalRequests = new ColumnProposalRequests();
  const panel = docsEditPanel(
    silentLog(),
    {
      docGenService,
      dbtTestService,
      queryManifestService,
      emitterService: { eventEmitter: { event: vi.fn() } },
      columnProposals,
      columnProposalRequests,
    },
    projects,
  ) as any;
  window.activeTextEditor = {
    document: { uri: Uri.file("/p/models/orders.sql") },
  } as never;
  const page = openPage(panel, fakeView(), false);
  return {
    panel,
    fake: page.fake,
    view: page.page,
    postMessage: page.page.webview.postMessage,
    project,
    projects,
    docs,
    payload,
    columnProposals,
    columnProposalRequests,
    dbtTestService,
    docGenService,
    queryManifestService,
    send: page.send,
  };
}

const cancellation = () => ({
  isCancellationRequested: false,
  onCancellationRequested: new EventEmitter<void>().event,
});

describe("documentation editor messages", () => {
  const rows: Record<string, Row> = {
    "webview:ready": async () => {
      const h = docsHarness();
      await h.send({ command: "webview:ready" });
      expect(isPageReady(h.panel, h.view)).toBe(true);
    },
    openProblemsTab: async () => {
      const h = docsHarness();
      await h.send({ command: "openProblemsTab" });
      expect(commands.executeCommand).toHaveBeenCalledWith(
        "workbench.action.problems.focus",
      );
    },
    showInformationMessage: async () => {
      const h = docsHarness();
      await h.send({
        command: "showInformationMessage",
        infoMessage: "Saved",
        items: ["Undo"],
        syncRequestId: "i1",
      });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        "Saved",
        "Undo",
      );
      expect(h.postMessage).toHaveBeenCalledWith(response("i1", undefined));
    },
    showWarningMessage: async () => {
      const h = docsHarness();
      await h.send({
        command: "showWarningMessage",
        infoMessage: "Careful",
        syncRequestId: "w1",
      });
      expect(window.showWarningMessage).toHaveBeenCalledWith("Careful");
      expect(h.postMessage).toHaveBeenCalledWith(response("w1", undefined));
    },
    getCurrentModelDocumentation: async () => {
      const h = docsHarness();
      await h.send({ command: "getCurrentModelDocumentation" });
      expect(h.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "renderDocumentation",
          docs: h.docs,
        }),
      );
    },
    saveDraft: async () => {
      const h = docsHarness();
      const draft = { docs: { ...h.docs, description: "unsaved" }, tests: [] };
      await h.send({ command: "saveDraft", model: h.docs.filePath, draft });
      await h.send({ command: "getCurrentModelDocumentation" });
      expect(h.postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ command: "renderDocumentation", draft }),
      );
    },
    getTestCode: async () => {
      const h = docsHarness();
      const test = { key: "not_null_orders_id", column_name: "id" };
      // The editor moves on while the request runs; the test config still comes from the model the request resolved.
      h.dbtTestService.getConfigByTest.mockImplementationOnce(() => {
        window.activeTextEditor = {
          document: { uri: Uri.file("/p/models/customers.sql") },
        } as never;
        return { severity: "warn" };
      });
      await h.send({
        command: "getTestCode",
        test,
        model: "orders",
        syncRequestId: "g1",
      });
      expect(h.dbtTestService.getConfigByTest).toHaveBeenCalledWith(
        test,
        "orders",
        {
          columnNameFromTestMetadata: "id",
          uri: Uri.file("/p/models/orders.sql"),
        },
      );
      expect(h.postMessage).toHaveBeenCalledWith(
        response("g1", { config: { severity: "warn" } }),
      );
    },
    getUnitTestCode: async () => {
      const dir = mkdtempSync(join(tmpdir(), "docs-panel-"));
      try {
        const path = join(dir, "orders.yml");
        writeFileSync(path, "unit_tests: []\n");
        const h = docsHarness();
        await h.send({ command: "getUnitTestCode", path, syncRequestId: "u1" });
        expect(h.postMessage).toHaveBeenCalledWith(
          response("u1", { yaml: "unit_tests: []\n" }),
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    getDistinctColumnValues: async () => {
      const h = docsHarness();
      await h.send({
        command: "getDistinctColumnValues",
        model: "orders",
        column: "id",
        syncRequestId: "d1",
      });
      expect(h.project.queries.getColumnValues).toHaveBeenCalledWith(
        "orders",
        "id",
      );
      expect(h.postMessage).toHaveBeenCalledWith(response("d1", ["a", "b"]));
    },
    getColumnsOfSources: async () => {
      const h = docsHarness();
      await h.send({
        command: "getColumnsOfSources",
        source: "raw",
        table: "orders",
        syncRequestId: "cs1",
      });
      expect(h.project.queries.getColumnsOfSource).toHaveBeenCalledWith(
        "raw",
        "orders",
      );
      expect(h.postMessage).toHaveBeenCalledWith(
        response("cs1", { columns: ["id"] }),
      );
    },
    getColumnsOfModel: async () => {
      const h = docsHarness();
      await h.send({
        command: "getColumnsOfModel",
        model: "orders",
        syncRequestId: "cm1",
      });
      expect(h.project.queries.getColumnsOfModel).toHaveBeenCalledWith(
        "orders",
      );
      expect(h.postMessage).toHaveBeenCalledWith(
        response("cm1", { columns: ["id"] }),
      );
    },
    getSourcesInProject: async () => {
      const h = docsHarness();
      await h.send({ command: "getSourcesInProject", syncRequestId: "s1" });
      expect(h.postMessage).toHaveBeenCalledWith(
        response("s1", { sources: ["raw.orders"] }),
      );
    },
    getModelsInProject: async () => {
      const h = docsHarness();
      await h.send({ command: "getModelsInProject", syncRequestId: "m1" });
      expect(h.postMessage).toHaveBeenCalledWith(
        response("m1", { models: ["orders"] }),
      );
    },
    proposeColumns: async () => {
      const h = docsHarness();
      const draft = {
        docs: { ...h.docs, columns: [{ name: "id", type: "text" }] },
        tests: [],
      };
      await h.send({ command: "saveDraft", model: h.docs.filePath, draft });
      await h.send({ command: "proposeColumns", kind: "types" });
      const [kind, target] = h.columnProposals.propose.mock.calls[0] as [
        string,
        { yaml: unknown; draft: unknown },
      ];
      expect(kind).toBe("types");
      expect(target.draft).toEqual([{ name: "id", type: "text" }]);
      expect(target.yaml).toEqual([{ name: "id", type: "int" }]);
      expect(h.postMessage).toHaveBeenCalledWith({
        command: "renderColumnProposals",
        payload: h.payload,
      });
      expect(
        isDocumentationEditorHostMessage(h.postMessage.mock.calls[0][0]),
      ).toBe(true);
      h.columnProposals.propose.mockResolvedValueOnce(undefined);
      h.postMessage.mockClear();
      await h.send({ command: "proposeColumns", kind: "descriptions" });
      expect(h.postMessage).not.toHaveBeenCalled();
    },
    runNoticeAction: async () => {
      const h = docsHarness();
      await h.send({ command: "runNoticeAction", action: "useStrictAnalysis" });
      expect(commands.executeCommand).toHaveBeenCalledWith(
        "fusionPowerUser.useStrictAnalysis",
        Uri.file("/p"),
      );
    },
    saveDocumentation: async () => {
      const h = docsHarness();
      await h.send({
        command: "saveDocumentation",
        ...h.docs,
        patchPath: "models/schema.yml",
        updatedTests: [],
        syncRequestId: "sv1",
      });
      expect(workspace.applyEdit).toHaveBeenCalledTimes(1);
      expect(h.docGenService.getUncompiledDocumentation).toHaveBeenCalledWith(
        Uri.file("/p/models/orders.sql").fsPath,
      );
      expect(h.postMessage).toHaveBeenCalledWith(
        response("sv1", expect.objectContaining({ saved: true })),
      );
    },
  };

  it("has a row for every panelCommands entry", () => {
    expectRowsCover(rows, documentationEditor.panelCommands);
  });

  it.each(Object.entries(rows))("%s", async (_command, row) => {
    await row();
  });
});

describe("column proposal requests", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for the page, then posts the documentation and the proposals in that order", async () => {
    vi.useFakeTimers();
    const h = docsHarness();
    // Resolving the view rendered orders; the editor then moves to customers, so that render is stale.
    await vi.advanceTimersByTimeAsync(0);
    const customers = {
      ...h.docs,
      name: "customers",
      filePath: "/p/models/customers.sql",
    };
    window.activeTextEditor = {
      document: { uri: Uri.file(customers.filePath) },
    } as never;
    h.docGenService.getUncompiledDocumentationForCurrentActiveFile.mockResolvedValue(
      {
        documentation: customers,
      },
    );
    h.postMessage.mockClear();
    h.columnProposalRequests.request("types");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.postMessage).not.toHaveBeenCalled();

    await h.send({ command: "webview:ready" });
    await vi.advanceTimersByTimeAsync(500);
    expect(
      h.postMessage.mock.calls.map(([message]) => message.command),
    ).toEqual(["renderDocumentation", "renderColumnProposals"]);
    expect(h.postMessage.mock.calls[0][0]).toMatchObject({
      command: "renderDocumentation",
      docs: { name: "customers" },
    });
    expect(h.postMessage).toHaveBeenCalledWith({
      command: "renderColumnProposals",
      payload: h.payload,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("warns and posts no proposals when the active model has no project", async () => {
    vi.useFakeTimers();
    const h = docsHarness();
    h.projects.get.mockReturnValue(undefined);
    await h.send({ command: "webview:ready" });
    h.columnProposalRequests.request("types");
    await vi.advanceTimersByTimeAsync(500);
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      "No dbt project for the model orders",
    );
    expect(h.columnProposals.propose).not.toHaveBeenCalled();
    expect(
      h.postMessage.mock.calls.some(
        ([message]) => message.command === "renderColumnProposals",
      ),
    ).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for the new page's webview:ready after the view is hidden", async () => {
    vi.useFakeTimers();
    const h = docsHarness();
    await h.send({ command: "webview:ready" });

    h.fake.hide();
    h.columnProposalRequests.request("types");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(
      h.postMessage.mock.calls.some(
        ([message]) => message.command === "renderColumnProposals",
      ),
    ).toBe(false);

    h.fake.show();
    await h.send({ command: "webview:ready" });
    await vi.advanceTimersByTimeAsync(500);
    expect(h.postMessage).toHaveBeenCalledWith({
      command: "renderColumnProposals",
      payload: h.payload,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for webview:ready again when the view is resolved again", async () => {
    vi.useFakeTimers();
    const h = docsHarness();
    await h.send({ command: "webview:ready" });

    await h.panel.resolveWebviewView(h.view, {}, cancellation());
    expect(isPageReady(h.panel, h.view)).toBe(false);
  });

  it("shows a warning and posts nothing when the page does not load by the deadline", async () => {
    vi.useFakeTimers();
    const h = docsHarness();
    // Resolving the view posts its own renderDocumentation; the assertions below are about the request's posts.
    await vi.advanceTimersByTimeAsync(0);
    h.postMessage.mockClear();
    h.columnProposalRequests.request("descriptions");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      "The documentation editor did not load; try again",
    );
    expect(h.columnProposals.propose).not.toHaveBeenCalled();
    expect(h.postMessage).not.toHaveBeenCalled();
  });
});
