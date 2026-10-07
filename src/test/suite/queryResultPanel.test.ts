import { afterEach, describe, expect, it, vi } from "vitest";
import { commands, window } from "vscode";
import { ExecuteSQLError } from "../../core/dbtCommand";
import { QueryResultPanel } from "../../features/queryResults/queryResultPanel";

const log = () => ({
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
});

const bottomView = () => ({
  show: vi.fn(),
  webview: {
    postMessage: vi.fn(),
    onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
  },
});

const project = (over: Record<string, unknown> = {}) => ({
  getAdapterType: () => "duckdb",
  getProjectName: () => "jaffle",
  executeSQLOnQueryPanel: vi.fn(),
  executeSQLWithLimitOnQueryPanel: vi.fn(),
  ...over,
});

function makePanel(
  manifest: {
    project?: ReturnType<typeof project> | undefined;
    picked?: ReturnType<typeof project> | undefined;
  } = {},
) {
  const service = {
    manifestFor: () => undefined,
    getProject: () => manifest.project,
    getProjectByName: () => manifest.project,
    getOrPickProjectFromWorkspace: async () => manifest.picked,
  };
  const panel = new QueryResultPanel(
    {} as never,
    { eventEmitter: { event: () => ({ dispose: vi.fn() }) } } as never,
    log() as never,
    service as never,
    () => ({ dispose: vi.fn() }),
  ) as any;
  const view = bottomView();
  panel._panel = view;
  panel._bottomPanel = view;
  panel.isWebviewReady = true;
  return {
    panel,
    view,
    posted: () => view.webview.postMessage.mock.calls.map((c) => c[0]),
  };
}

const output = (rows = 1) => ({
  table: {
    column_names: ["n"],
    column_types: ["integer"],
    rows: Array.from({ length: rows }, (_, i) => [i]),
  },
  raw_code: "",
  compiled_sql: "select compiled",
  modelName: "orders",
});

describe("QueryResultPanel", () => {
  afterEach(() => {
    vi.clearAllMocks();
    (window as any).activeTextEditor = undefined;
  });

  describe("executeQuery", () => {
    it("renders loading, then the rows, and records history", async () => {
      const { panel, posted } = makePanel({ project: project() });
      const result = await panel.executeQuery(
        "select 1",
        Promise.resolve({ executeQuery: async () => output(2) }),
        "jaffle",
      );
      expect(commands.executeCommand).toHaveBeenCalledWith(
        "fusionPowerUser.PreviewResults.focus",
      );
      expect(posted().map((m) => m.command)).toEqual([
        "renderLoading",
        "renderQuery",
      ]);
      expect(result).toMatchObject({
        columnNames: ["n"],
        rows: [{ n: 0 }, { n: 1 }],
        raw_sql: "select 1",
        compiled_sql: "select compiled",
      });
      expect(panel.history.all()).toHaveLength(1);
      expect(panel.history.all()[0]).toMatchObject({
        rawSql: "select 1",
        adapter: "duckdb",
        projectName: "jaffle",
        modelName: "orders",
      });
    });

    it("keeps only the ten most recent history entries", async () => {
      const { panel } = makePanel({ project: project() });
      for (let i = 0; i < 12; i++) {
        await panel.executeQuery(
          `select ${i}`,
          Promise.resolve({ executeQuery: async () => output() }),
          "jaffle",
        );
      }
      expect(panel.history.all()).toHaveLength(10);
      expect(panel.history.all()[0].rawSql).toBe("select 11");
    });

    it("skips history when no project is found", async () => {
      const { panel } = makePanel();
      await panel.executeQuery(
        "select 1",
        Promise.resolve({ executeQuery: async () => output() }),
        "",
      );
      expect(panel.history.all()).toEqual([]);
    });

    it("renders a server error and notifies", async () => {
      const { panel, posted } = makePanel({ project: project() });
      await panel.executeQuery(
        "select nope",
        Promise.resolve({
          executeQuery: async () => {
            throw new ExecuteSQLError("bad column", "select compiled nope");
          },
        }),
        "jaffle",
      );
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("bad column"),
        "Show output",
      );
      const error = posted().find((m) => m.command === "renderError");
      expect(error).toMatchObject({
        error: { code: -1, message: "bad column" },
        raw_sql: "select nope",
        compiled_sql: "select compiled nope",
      });
    });

    it("renders any other failure as an error without a toast", async () => {
      const { panel, posted } = makePanel();
      await panel.executeQuery(
        "select 1",
        Promise.reject(new Error("boom")),
        "",
      );
      expect(window.showErrorMessage).not.toHaveBeenCalled();
      expect(posted().find((m) => m.command === "renderError")).toMatchObject({
        error: { message: "Error: boom" },
      });
    });
  });

  describe("messages", () => {
    it("ignores messages the contract does not define", async () => {
      const { panel, posted } = makePanel();
      await panel.handleCommand({ command: "nonsense" });
      expect(posted()).toEqual([]);
    });

    it("returns and clears the query history", async () => {
      const { panel, posted } = makePanel({ project: project() });
      await panel.executeQuery(
        "select 1",
        Promise.resolve({ executeQuery: async () => output() }),
        "jaffle",
      );
      await panel.handleCommand({ command: "getQueryHistory" });
      expect(posted().at(-1)).toMatchObject({
        command: "queryHistory",
        args: { body: [expect.objectContaining({ rawSql: "select 1" })] },
      });
      await panel.handleCommand({
        command: "clearQueryHistory",
        syncRequestId: "s1",
      });
      expect(panel.history.all()).toEqual([]);
      expect(posted().at(-1)).toMatchObject({
        command: "response",
        args: { syncRequestId: "s1", status: true },
      });
    });

    it("cancels the running query and resets the page", async () => {
      const { panel, posted } = makePanel();
      const cancel = vi.fn();
      panel.queryExecution = { cancel };
      await panel.handleCommand({ command: "cancelQuery" });
      expect(cancel).toHaveBeenCalled();
      expect(posted().at(-1)).toMatchObject({ command: "resetState" });
    });

    it("runs a history query on the named project with its limit", async () => {
      const target = project();
      const { panel } = makePanel({ project: target });
      await panel.handleCommand({
        command: "executeQuery",
        query: "select 2",
        projectName: "jaffle",
        limit: 50,
      });
      expect(target.executeSQLWithLimitOnQueryPanel).toHaveBeenCalledWith(
        "select 2",
        "",
        50,
      );
      await panel.handleCommand({
        command: "executeQuery",
        query: "select 3",
        projectName: "jaffle",
      });
      expect(target.executeSQLOnQueryPanel).toHaveBeenCalledWith(
        "select 3",
        "",
      );
    });

    it("reports a history query whose project is gone", async () => {
      const { panel } = makePanel();
      await panel.handleCommand({
        command: "executeQuery",
        query: "select 2",
        projectName: "gone",
      });
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("Unable to execute query"),
        "Show output",
      );
    });

    it("runs the active editor's selection with the page limit", async () => {
      const target = project();
      const { panel } = makePanel({ picked: target });
      (window as any).activeTextEditor = {
        document: {
          uri: { fsPath: "/p/models/orders.sql" },
          getText: (range?: unknown) => (range ? "selected" : "whole"),
        },
        selection: {
          isEmpty: false,
          start: { line: 0, character: 0 },
          end: { line: 0, character: 3 },
        },
      };
      await panel.handleCommand({
        command: "executeQueryFromActiveWindow",
        limit: 7,
      });
      expect(target.executeSQLWithLimitOnQueryPanel).toHaveBeenCalledWith(
        "selected",
        "orders",
        7,
      );
    });

    it("reports a missing editor or project", async () => {
      const { panel } = makePanel();
      await panel.handleCommand({
        command: "executeQueryFromActiveWindow",
        limit: 1,
      });
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        "No active editor found",
        "Show output",
      );
      (window as any).activeTextEditor = {
        document: { uri: { fsPath: "/p/a.sql" }, getText: () => "" },
      };
      await panel.handleCommand({
        command: "executeQueryFromActiveWindow",
        limit: 1,
      });
      expect(window.showErrorMessage).toHaveBeenLastCalledWith(
        "Unable to find dbt project for executing query",
        "Show output",
      );
    });

    it("queues the loading message until the page is ready", async () => {
      const { panel, posted } = makePanel();
      panel.isWebviewReady = false;
      await panel.transmitLoading();
      expect(posted()).toEqual([]);
      panel.onWebviewReady();
      expect(posted()).toEqual([{ command: "renderLoading" }]);
    });
  });
});
