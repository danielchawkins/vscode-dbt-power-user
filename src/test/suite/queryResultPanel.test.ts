import { afterEach, describe, expect, it, vi } from "vitest";
import { commands, Uri, window } from "vscode";
import { ExecuteSQLError } from "../../core/dbtCommand";
import { QueryResultPanel } from "../../features/queryResults/queryResultPanel";
import type * as panelHtmlModule from "../../webview/panelHtml";
import { flushAsync } from "../async";
import { fakeView } from "../panelHarness";
import { silentLog } from "../testLog";

vi.mock("../../webview/panelHtml", async (importOriginal) => ({
  ...(await importOriginal<typeof panelHtmlModule>()),
  panelHtml: () => "<html>query results</html>",
}));

const project = (over: Record<string, unknown> = {}) => ({
  getAdapterType: () => "duckdb",
  getProjectName: () => "jaffle",
  queries: {
    executeSQLOnQueryPanel: vi.fn(),
    executeSQLWithLimitOnQueryPanel: vi.fn(),
  },
  ...over,
});

function makePanel(
  manifest: {
    project?: ReturnType<typeof project> | undefined;
    picked?: ReturnType<typeof project> | undefined;
  } = {},
  ready = true,
) {
  const service = {
    manifestFor: () => undefined,
    getProject: () => manifest.project,
    getProjectByName: () => manifest.project,
    getOrPickProjectFromWorkspace: async () => manifest.picked,
  };
  const panel = new QueryResultPanel({
    extensionContext: { extensionUri: Uri.file("/ext") } as never,
    eventEmitterService: {
      eventEmitter: { event: () => ({ dispose: vi.fn() }) },
    } as never,
    dbtTerminal: silentLog(),
    queryManifestService: service as never,
    onDidRemoveProject: () => ({ dispose: vi.fn() }),
  });
  const view = fakeView();
  void panel.resolveWebviewView(
    view.page,
    {} as never,
    { onCancellationRequested: vi.fn() } as never,
  );
  if (ready) {
    void view.send({ command: "webview:ready" });
  }
  return {
    panel,
    view,
    posted: () => view.posted(),
    send: view.send,
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

  describe("switchPreview", () => {
    const model = "/project/models/orders.sql";

    it("re-runs the model computed through its computed preview command", async () => {
      const { send } = makePanel({ project: project() });
      await send({
        command: "switchPreview",
        mode: "computed",
        model,
      });
      expect(commands.executeCommand).toHaveBeenCalledWith(
        "fusionPowerUser.previewComputed",
        { url: model },
      );
    });
  });

  describe("executeQuery", () => {
    it("renders loading, then the rows, and records history", async () => {
      const { panel, posted } = makePanel({ project: project() });
      const result = await panel.executeQuery({
        query: "select 1",
        fn: Promise.resolve({ executeQuery: async () => output(2) } as never),
        projectName: "jaffle",
      });
      expect(commands.executeCommand).toHaveBeenCalledWith(
        "fusionPowerUser.PreviewResults.focus",
      );
      expect(posted().map((m) => (m as { command: string }).command)).toEqual([
        "renderLoading",
        "renderQuery",
      ]);
      expect(result).toMatchObject({
        columnNames: ["n"],
        rows: [{ n: 0 }, { n: 1 }],
        raw_sql: "select 1",
        compiled_sql: "select compiled",
      });
      expect((panel as any).history.all()).toHaveLength(1);
      expect((panel as any).history.all()[0]).toMatchObject({
        rawSql: "select 1",
        adapter: "duckdb",
        projectName: "jaffle",
        modelName: "orders",
      });
    });

    it("carries the model preview on a rendered result and on an error", async () => {
      const { panel, posted } = makePanel({ project: project() });
      const preview = {
        mode: "computed" as const,
        model: "/project/models/orders.sql",
      };
      await panel.executeQuery({
        query: "select 1",
        fn: Promise.resolve({ executeQuery: async () => output() } as never),
        projectName: "jaffle",
        preview,
      });
      await panel.executeQuery({
        query: "select nope",
        fn: Promise.reject(new Error("boom")),
        projectName: "jaffle",
        preview,
      });
      expect(
        posted().find(
          (m) => (m as { command: string }).command === "renderQuery",
        ),
      ).toMatchObject({
        preview,
      });
      expect(
        posted().find(
          (m) => (m as { command: string }).command === "renderError",
        ),
      ).toMatchObject({
        preview,
      });
    });

    it("keeps only the ten most recent history entries", async () => {
      const { panel } = makePanel({ project: project() });
      for (let i = 0; i < 12; i++) {
        await panel.executeQuery({
          query: `select ${i}`,
          fn: Promise.resolve({ executeQuery: async () => output() } as never),
          projectName: "jaffle",
        });
      }
      expect((panel as any).history.all()).toHaveLength(10);
      expect((panel as any).history.all()[0].rawSql).toBe("select 11");
    });

    it("skips history when no project is found", async () => {
      const { panel } = makePanel();
      await panel.executeQuery({
        query: "select 1",
        fn: Promise.resolve({ executeQuery: async () => output() } as never),
        projectName: "",
      });
      expect((panel as any).history.all()).toEqual([]);
    });

    it("renders a server error and notifies", async () => {
      const { panel, posted } = makePanel({ project: project() });
      await panel.executeQuery({
        query: "select nope",
        fn: Promise.resolve({
          executeQuery: async () => {
            throw new ExecuteSQLError("bad column", "select compiled nope");
          },
        } as never),
        projectName: "jaffle",
      });
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("bad column"),
        "Show output",
      );
      const error = posted().find(
        (m) => (m as { command: string }).command === "renderError",
      );
      expect(error).toMatchObject({
        error: { code: -1, message: "bad column" },
        raw_sql: "select nope",
        compiled_sql: "select compiled nope",
      });
    });

    it("renders any other failure as an error without a toast", async () => {
      const { panel, posted } = makePanel();
      await panel.executeQuery({
        query: "select 1",
        fn: Promise.reject(new Error("boom")),
        projectName: "",
      });
      expect(window.showErrorMessage).not.toHaveBeenCalled();
      expect(
        posted().find(
          (m) => (m as { command: string }).command === "renderError",
        ),
      ).toMatchObject({
        error: { message: "boom" },
      });
    });
  });

  describe("messages", () => {
    it("returns and clears the query history", async () => {
      const { panel, posted, send } = makePanel({ project: project() });
      await panel.executeQuery({
        query: "select 1",
        fn: Promise.resolve({ executeQuery: async () => output() } as never),
        projectName: "jaffle",
      });
      await send({ command: "getQueryHistory" });
      expect(posted().at(-1)).toMatchObject({
        command: "queryHistory",
        args: { body: [expect.objectContaining({ rawSql: "select 1" })] },
      });
      await send({
        command: "clearQueryHistory",
        syncRequestId: "s1",
      });
      expect((panel as any).history.all()).toEqual([]);
      expect(posted().at(-1)).toMatchObject({
        command: "response",
        args: { syncRequestId: "s1", status: true },
      });
    });

    it("runs a history query on the named project with its limit", async () => {
      const target = project();
      const { send } = makePanel({ project: target });
      await send({
        command: "executeQuery",
        query: "select 2",
        projectName: "jaffle",
        limit: 50,
      });
      expect(
        target.queries.executeSQLWithLimitOnQueryPanel,
      ).toHaveBeenCalledWith("select 2", "", 50);
      await send({
        command: "executeQuery",
        query: "select 3",
        projectName: "jaffle",
      });
      expect(target.queries.executeSQLOnQueryPanel).toHaveBeenCalledWith(
        "select 3",
        "",
      );
    });

    it("reports a history query whose project is gone", async () => {
      const { send } = makePanel();
      await send({
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
      const { send } = makePanel({ picked: target });
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
      await send({
        command: "executeQueryFromActiveWindow",
        limit: 7,
      });
      expect(
        target.queries.executeSQLWithLimitOnQueryPanel,
      ).toHaveBeenCalledWith("selected", "orders", 7);
    });

    it("reports a missing editor or project", async () => {
      const { send } = makePanel();
      await send({
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
      await send({
        command: "executeQueryFromActiveWindow",
        limit: 1,
      });
      expect(window.showErrorMessage).toHaveBeenLastCalledWith(
        "Unable to find dbt project for executing query",
        "Show output",
      );
    });

    it("queues the loading message until the page is ready", async () => {
      const { panel, posted, view, send } = makePanel({}, false);
      void panel.executeQuery({
        query: "select 1",
        fn: new Promise(() => undefined),
        projectName: "",
      });
      await flushAsync();
      expect(posted()).toEqual([]);
      await send({
        command: "webview:ready",
      });
      expect(view.posted()).toEqual([{ command: "renderLoading" }]);
    });

    it("flushes each queued loading message last-in first-out once the page is ready", async () => {
      const { panel, posted, view, send } = makePanel({}, false);
      const queue = (panel as any).pendingMessages as unknown[];
      const pop = vi.spyOn(queue, "pop");
      const shift = vi.spyOn(queue, "shift");
      void panel.executeQuery({
        query: "select 1",
        fn: new Promise(() => undefined),
        projectName: "",
      });
      void panel.executeQuery({
        query: "select 2",
        fn: new Promise(() => undefined),
        projectName: "",
      });
      await flushAsync();
      expect(posted()).toEqual([]);
      await send({ command: "webview:ready" });
      expect(pop).toHaveBeenCalledTimes(2);
      // The queued messages are identical, so the order is pinned by the pop() flush itself, not by the posts.
      expect(shift).not.toHaveBeenCalled();
      expect(queue).toEqual([]);
      expect(view.posted()).toEqual([
        { command: "renderLoading" },
        { command: "renderLoading" },
      ]);
    });
  });

  describe("disposed view", () => {
    it("ignores a context update posted to a view VS Code has disposed", async () => {
      const { panel, view } = makePanel();
      Object.defineProperty(view.page, "webview", {
        get(): never {
          throw new Error("Webview is disposed");
        },
      });
      await expect(
        (panel as any).sendUpdatedContextToWebview(),
      ).resolves.toBeUndefined();
    });
  });
});
