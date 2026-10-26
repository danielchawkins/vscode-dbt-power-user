import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { commands, Uri, window, workspace } from "vscode";
import type { LineagePanel } from "../../features/lineage/lineagePanel";
import { resolveSourceStartingNode } from "../../features/lineage/lineageSources";
import type * as panelHtmlModule from "../../webview/panelHtml";
import { fakeView, lineagePanel, openPage } from "../panelHarness";
import { silentLog } from "../testLog";

vi.mock("../../webview/panelHtml", async (importOriginal) => ({
  ...(await importOriginal<typeof panelHtmlModule>()),
  panelHtml: () => "<html>lineage</html>",
}));

describe("LineagePanel", () => {
  let panel: LineagePanel;
  let mockPostMessage: Mock;
  let queryManifestService: Record<string, Mock>;
  let send: (message: unknown) => Promise<unknown>;
  let closePage: () => void;

  /** Sends a request as the page does, and returns the body the panel answered with. */
  const ask = async (message: Record<string, unknown>) => {
    await send({ syncRequestId: "ask", ...message });
    return mockPostMessage.mock.calls.findLast(
      ([response]) => response.command === "response",
    )?.[0].args.body;
  };

  beforeEach(() => {
    mockPostMessage = vi.fn();

    queryManifestService = {
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
    panel = lineagePanel(silentLog(), {
      extensionContext,
      dbtLineageService: {
        columnsNeedStrict: vi.fn().mockReturnValue(undefined),
      },
      queryManifestService,
    });
    const view = fakeView();
    const page = openPage(panel, view, false);
    mockPostMessage = page.page.webview.postMessage;
    send = page.send;
    closePage = () => view.close();
  });

  describe("manifestChanged", () => {
    it("offers one action, naming an explicit setting that overrides the project", () => {
      (panel as any).dbtLineageService.columnsNeedStrict = vi
        .fn()
        .mockReturnValue({ mode: "baseline", setting: "baseline" });
      (panel as any).getStartingNode = () => ({ node: { table: "model.p.a" } });

      panel.manifestChanged(undefined);

      const args = mockPostMessage.mock.lastCall![0].args;
      expect(args.columnsNeedStrict).toBe(true);
      expect(args.missingLineageMessage.message).toContain(
        'fusionPowerUser.staticAnalysis is "baseline", which overrides the project',
      );
      expect(args.missingLineageMessage.message).not.toContain(
        "dbt_project.yml",
      );
      expect(args.missingLineageMessage.actions).toEqual([
        { title: "Use strict analysis", action: "useStrictAnalysis" },
      ]);
    });

    it("offers the same action, naming the project default under project mode", () => {
      (panel as any).dbtLineageService.columnsNeedStrict = vi
        .fn()
        .mockReturnValue({ mode: "baseline", setting: "project" });
      (panel as any).getStartingNode = () => ({ node: { table: "model.p.a" } });

      panel.manifestChanged(undefined);

      const { message, actions } =
        mockPostMessage.mock.lastCall![0].args.missingLineageMessage;
      expect(message).toContain('is "project"');
      expect(message).toContain("has no +static_analysis: strict");
      expect(message).toContain("Fusion's default (baseline)");
      expect(actions).toEqual([
        { title: "Use strict analysis", action: "useStrictAnalysis" },
      ]);
    });

    it("shows no notice under strict analysis", () => {
      (panel as any).getStartingNode = () => ({ node: { table: "model.p.a" } });

      panel.manifestChanged(undefined);

      const args = mockPostMessage.mock.lastCall![0].args;
      expect(args.columnsNeedStrict).toBeUndefined();
      expect(args.missingLineageMessage).toBeUndefined();
    });

    it("runs the strict-analysis command for the current project's root", async () => {
      const projectRoot = { fsPath: "/w/p" };
      (panel as any).queryManifestService.getProject = () => ({ projectRoot });
      await send({
        command: "runNoticeAction",
        action: "useStrictAnalysis",
      });
      expect(commands.executeCommand).toHaveBeenCalledWith(
        "fusionPowerUser.useStrictAnalysis",
        projectRoot,
      );
    });

    it("re-renders when the project's client state or mode changes", () => {
      let fire = () => {};
      (panel as any)._disposables = [];
      (panel as any).getStartingNode = () => ({ node: { table: "model.p.a" } });
      panel.renderOn((listener) => {
        fire = listener;
        return { dispose: vi.fn() };
      });

      fire();

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: "render" }),
      );
    });
    it("should re-render the starting node when a manifest changes", () => {
      panel.manifestChanged(undefined);

      // renderStartingNode posts a "render" command to the webview
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: "render" }),
      );
    });

    it("should not throw when panel is not visible", () => {
      const unresolved = lineagePanel(silentLog(), { queryManifestService });

      expect(() => unresolved.manifestChanged(undefined)).not.toThrow();
    });
  });

  describe("getLineageSettings — defaultExpansion cap", () => {
    it("should cap defaultExpansion at 5 when user sets a higher value", async () => {
      const mockConfig = {
        get: vi
          .fn<(key: string) => unknown>()
          .mockImplementation((key: string) =>
            key === "lineage.defaultExpansion" ? 10 : undefined,
          ),
      };
      (workspace.getConfiguration as Mock).mockReturnValue(mockConfig);

      // Ask for the settings, as the page does
      await send({
        command: "getLineageSettings",
        args: {},
        syncRequestId: "test-sync-1",
      });

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "response",
          args: expect.objectContaining({
            body: expect.objectContaining({
              defaultExpansion: 5,
            }),
          }),
        }),
      );
    });

    it("should pass through defaultExpansion when within limit", async () => {
      const mockConfig = {
        get: vi
          .fn<(key: string) => unknown>()
          .mockImplementation((key: string) =>
            key === "lineage.defaultExpansion" ? 3 : undefined,
          ),
      };
      (workspace.getConfiguration as Mock).mockReturnValue(mockConfig);

      await send({
        command: "getLineageSettings",
        args: {},
        syncRequestId: "test-sync-2",
      });

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "response",
          args: expect.objectContaining({
            body: expect.objectContaining({
              defaultExpansion: 3,
            }),
          }),
        }),
      );
    });
  });

  it("lists a model's inferred columns merged with its declared ones", async () => {
    const node = {
      unique_id: "model.p.a",
      path: "/p/models/a.sql",
      description: "A",
      config: { materialized: "table" },
      columns: { id: { name: "id", description: "Key", data_type: "" } },
      meta: {},
    };
    (panel as any).queryManifestService = {
      getEventByCurrentProject: () => ({
        event: { nodeMetaMap: { lookupByUniqueId: () => node } },
      }),
      getProject: () => ({ projectRoot: { fsPath: "/p" } }),
    };
    const getInferredColumns = vi
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue([
        { name: "id", datatype: "integer" },
        { name: "total", datatype: "bigint" },
      ]);
    (panel as any).dbtLineageService = { getInferredColumns };

    const body = await ask({
      command: "getColumns",
      args: {
        params: {
          table: "model.p.a",
          refresh: false,
        },
      },
    });

    expect(getInferredColumns).toHaveBeenCalledWith("/p", "/p/models/a.sql");
    expect(
      body.columns.map((c: any) => [c.name, c.datatype, c.description]),
    ).toEqual([
      ["id", "integer", "Key"],
      ["total", "bigint", ""],
    ]);
  });

  it("answers a model refresh with inferred columns and never queries the DB", async () => {
    const node = {
      unique_id: "model.p.a",
      name: "a",
      path: "/p/models/a.sql",
      description: "A",
      config: { materialized: "table" },
      columns: {},
      meta: {},
    };
    const getColumnsOfModel = vi.fn();
    const mergeColumnsFromDB = vi.fn();
    (panel as any).queryManifestService = {
      getEventByCurrentProject: () => ({
        event: { nodeMetaMap: { lookupByUniqueId: () => node } },
      }),
      getProject: () => ({
        projectRoot: { fsPath: "/p" },
        queries: { getColumnsOfModel, mergeColumnsFromDB },
      }),
    };
    (panel as any).dbtLineageService = {
      getInferredColumns: vi
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue([{ name: "id", datatype: "integer" }]),
    };
    (window.withProgress as Mock).mockClear();

    const body = await ask({
      command: "getColumns",
      args: {
        params: {
          table: "model.p.a",
          refresh: true,
        },
      },
    });

    expect(getColumnsOfModel).not.toHaveBeenCalled();
    expect(mergeColumnsFromDB).not.toHaveBeenCalled();
    expect(window.withProgress).not.toHaveBeenCalled();
    expect(body.columns.map((c: any) => [c.name, c.datatype])).toEqual([
      ["id", "integer"],
    ]);
  });

  it("syncs a source's columns from the DB on refresh", async () => {
    const table = {
      name: "orders",
      description: "Raw orders",
      columns: {} as Record<string, any>,
    };
    const getColumnsOfSource = vi
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue([{ column: "id", dtype: "INTEGER" }]);
    const mergeColumnsFromDB = vi.fn((t: any, _columns: unknown) => {
      t.columns.id = { name: "id", data_type: "INTEGER", description: "" };
      return true;
    });
    (panel as any).queryManifestService = {
      getEventByCurrentProject: () => ({
        event: {
          sourceMetaMap: new Map([["raw", { name: "raw", tables: [table] }]]),
        },
      }),
      getProject: () => ({
        queries: { getColumnsOfSource, mergeColumnsFromDB },
      }),
    };
    (window.withProgress as Mock).mockImplementation(
      async (_opts: any, task: any) => task(),
    );

    const body = await ask({
      command: "getColumns",
      args: {
        params: {
          table: "source.p.raw.orders",
          refresh: true,
        },
      },
    });

    expect(getColumnsOfSource).toHaveBeenCalledWith("raw", "orders");
    expect(mergeColumnsFromDB).toHaveBeenCalledWith(table, [
      { column: "id", dtype: "INTEGER" },
    ]);
    expect(body.columns.map((c: any) => [c.name, c.datatype])).toEqual([
      ["id", "integer"],
    ]);
  });

  it("persists the component's edge settings and returns them", async () => {
    (workspace.getConfiguration as Mock).mockReturnValue({
      get: () => 3,
      update: vi.fn(),
    });

    await send({
      command: "persistLineageSettings",
      args: { params: { showSelectEdges: false, showNonSelectEdges: true } },
      syncRequestId: "p",
    });
    await send({
      command: "getLineageSettings",
      args: {},
      syncRequestId: "g",
    });

    expect(mockPostMessage).toHaveBeenLastCalledWith({
      command: "response",
      args: {
        syncRequestId: "g",
        body: {
          connections: "dbt",
          showSelectEdges: false,
          showNonSelectEdges: true,
          defaultExpansion: 3,
          maxNeighbours: 3,
          groupBy: "folder",
          layout: "layered",
          semanticZoom: true,
          title: "alias",
          layerColors: {},
        },
        status: true,
      },
    });
  });

  it("reads lineage.layout, treating any value but leftToRight as layered, and never persists it", async () => {
    const values: Record<string, unknown> = { "lineage.layout": "leftToRight" };
    (workspace.getConfiguration as Mock).mockReturnValue({
      get: (key: string) => values[key] ?? 3,
      update: vi.fn(),
    });
    await send({
      command: "persistLineageSettings",
      args: { params: { layout: "layered" } },
      syncRequestId: "p",
    });
    await send({
      command: "getLineageSettings",
      syncRequestId: "g",
    });
    expect(mockPostMessage.mock.lastCall![0].args.body.layout).toBe(
      "leftToRight",
    );

    values["lineage.layout"] = "typo";
    await send({
      command: "getLineageSettings",
      syncRequestId: "g2",
    });
    expect(mockPostMessage.mock.lastCall![0].args.body.layout).toBe("layered");
  });

  it("reads lineage.groupBy, treating any value but none as folder, and never persists it", async () => {
    const values: Record<string, unknown> = { "lineage.groupBy": "none" };
    (workspace.getConfiguration as Mock).mockReturnValue({
      get: (key: string) => values[key] ?? 3,
      update: vi.fn(),
    });
    await send({
      command: "persistLineageSettings",
      args: { params: { groupBy: "folder" } },
      syncRequestId: "p",
    });
    await send({
      command: "getLineageSettings",
      syncRequestId: "g",
    });
    expect(mockPostMessage.mock.lastCall![0].args.body.groupBy).toBe("none");

    values["lineage.groupBy"] = "typo";
    await send({
      command: "getLineageSettings",
      syncRequestId: "g2",
    });
    expect(mockPostMessage.mock.lastCall![0].args.body.groupBy).toBe("folder");
  });

  it("reads lineage.semanticZoom, false only when exactly false, and never persists it", async () => {
    const values: Record<string, unknown> = { "lineage.semanticZoom": false };
    (workspace.getConfiguration as Mock).mockReturnValue({
      get: (key: string) => values[key] ?? 3,
      update: vi.fn(),
    });
    await send({
      command: "persistLineageSettings",
      args: { params: { semanticZoom: true } },
      syncRequestId: "p",
    });
    await send({
      command: "getLineageSettings",
      syncRequestId: "g",
    });
    expect(mockPostMessage.mock.lastCall![0].args.body.semanticZoom).toBe(
      false,
    );

    values["lineage.semanticZoom"] = "typo";
    await send({
      command: "getLineageSettings",
      syncRequestId: "g2",
    });
    expect(mockPostMessage.mock.lastCall![0].args.body.semanticZoom).toBe(true);
  });

  it("reads lineage.title, name only when exactly name, and never persists it", async () => {
    const values: Record<string, unknown> = { "lineage.title": "name" };
    (workspace.getConfiguration as Mock).mockReturnValue({
      get: (key: string) => values[key] ?? 3,
      update: vi.fn(),
    });
    await send({
      command: "persistLineageSettings",
      args: { params: { title: "alias" } },
      syncRequestId: "p",
    });
    await send({
      command: "getLineageSettings",
      syncRequestId: "g",
    });
    expect(mockPostMessage.mock.lastCall![0].args.body.title).toBe("name");

    values["lineage.title"] = "typo";
    await send({
      command: "getLineageSettings",
      syncRequestId: "g2",
    });
    expect(mockPostMessage.mock.lastCall![0].args.body.title).toBe("alias");
  });

  it("persists only known settings and clamps the confidence threshold", async () => {
    (workspace.getConfiguration as Mock).mockReturnValue({
      get: () => 3,
      update: vi.fn(),
    });

    for (const [syncRequestId, threshold] of [
      ["hi", 7],
      ["lo", -2],
    ] as const) {
      await send({
        command: "persistLineageSettings",
        args: {
          params: {
            connections: "dbt",
            inferenceConfidenceThreshold: threshold,
            sqlText: "select secret",
          },
        },
        syncRequestId,
      });
      await send({
        command: "getLineageSettings",
        syncRequestId: "g",
      });
      expect(mockPostMessage.mock.lastCall![0].args.body).toEqual({
        showSelectEdges: true,
        showNonSelectEdges: false,
        connections: "dbt",
        inferenceConfidenceThreshold: threshold > 1 ? 1 : 0,
        defaultExpansion: 3,
        maxNeighbours: 3,
        groupBy: "folder",
        layout: "layered",
        semanticZoom: true,
        title: "alias",
        layerColors: {},
      });
    }
  });

  it.each([
    [{ kind: "notRunning", state: "failed" }, "is failed"],
    [
      { kind: "failed", message: "boom" },
      "Could not read column lineage: boom",
    ],
  ])("explains %j on each target table", async (reason, expected) => {
    (panel as any).dbtLineageService = {
      getConnectedColumns: vi
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue({ kind: "noLineage", reason }),
    };

    await send({
      command: "getConnectedColumns",
      args: {
        params: {
          targets: [["model.p.a", "id"]],
          upstreamExpansion: true,
          trace: "model.p.a.id",
        },
      },
      syncRequestId: "cll-2",
    });

    const body = mockPostMessage.mock.calls[0][0].args.body;
    expect(body.column_lineage).toEqual([]);
    expect(Object.keys(body.errors)).toEqual(["model.p.a"]);
    expect(body.errors["model.p.a"][0]).toContain(expected);
  });

  it("keeps lineage and reports each failed column", async () => {
    (panel as any).dbtLineageService = {
      getConnectedColumns: vi
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue({
          kind: "lineage",
          columnLineage: [],
          failures: [{ target: ["model.p.x", "y"], message: "timeout" }],
        }),
    };

    await send({
      command: "getConnectedColumns",
      args: {
        params: {
          targets: [["model.p.x", "y"]],
          upstreamExpansion: false,
          trace: "model.p.x.y",
        },
      },
      syncRequestId: "cll-3",
    });

    const body = mockPostMessage.mock.calls[0][0].args.body;
    expect(body.errors).toEqual({
      "model.p.x": ["Could not read column lineage for y: timeout"],
    });
  });

  describe("column trace cancellation", () => {
    const traced = (trace: string, syncRequestId: string) => ({
      command: "getConnectedColumns",
      args: {
        params: {
          targets: [["model.p.a", "id"]],
          upstreamExpansion: true,
          trace,
        },
      },
      syncRequestId,
    });
    const answerTo = (syncRequestId: string) =>
      mockPostMessage.mock.calls.find(
        ([response]) =>
          response.command === "response" &&
          response.args.syncRequestId === syncRequestId,
      )?.[0].args.body;

    it("answers a trace that a new trace supersedes as cancelled, with no columns", async () => {
      let finish: (value: unknown) => void = () => undefined;
      (panel as any).dbtLineageService = {
        getConnectedColumns: vi
          .fn<(...args: any[]) => Promise<any>>()
          .mockImplementationOnce(
            () =>
              new Promise((resolve) => {
                finish = resolve;
              }),
          )
          .mockResolvedValueOnce({ kind: "lineage", columnLineage: [] }),
      };

      const first = send(traced("a", "trace-a"));
      await send(traced("b", "trace-b"));
      finish({ kind: "lineage", columnLineage: [] });
      await first;

      expect(answerTo("trace-a")).toEqual({
        column_lineage: [],
        cancelled: true,
      });
      expect(answerTo("trace-b")).toEqual({ column_lineage: [] });
    });

    it("cancels only the trace that cancelColumnTrace names", async () => {
      const tokens: { isCancellationRequested: boolean }[] = [];
      let finish: (value: unknown) => void = () => undefined;
      (panel as any).dbtLineageService = {
        getConnectedColumns: vi.fn((_request, token) => {
          tokens.push(token);
          return new Promise((resolve) => {
            finish = resolve;
          });
        }),
      };

      const pending = send(traced("a", "trace-a"));
      await send({ command: "cancelColumnTrace", trace: "other" });
      expect(tokens[0].isCancellationRequested).toBe(false);

      await send({ command: "cancelColumnTrace", trace: "a" });
      expect(tokens[0].isCancellationRequested).toBe(true);
      finish({ kind: "lineage", columnLineage: [] });
      await pending;
      expect(answerTo("trace-a")).toEqual({
        column_lineage: [],
        cancelled: true,
      });
    });

    it("cancels the trace's requests when the panel is disposed", async () => {
      const tokens: { isCancellationRequested: boolean }[] = [];
      (panel as any).dbtLineageService = {
        getConnectedColumns: vi.fn((_request, token) => {
          tokens.push(token);
          return new Promise(() => undefined);
        }),
      };

      void send(traced("a", "trace-a"));
      await vi.waitFor(() => expect(tokens).toHaveLength(1));
      expect(tokens[0].isCancellationRequested).toBe(false);
      panel.dispose();
      expect(tokens[0].isCancellationRequested).toBe(true);
    });

    it("cancels the trace's requests when its page closes", async () => {
      const tokens: { isCancellationRequested: boolean }[] = [];
      (panel as any).dbtLineageService = {
        getConnectedColumns: vi.fn((_request, token) => {
          tokens.push(token);
          return new Promise(() => undefined);
        }),
      };

      void send(traced("a", "trace-a"));
      await vi.waitFor(() => expect(tokens).toHaveLength(1));
      expect(tokens[0].isCancellationRequested).toBe(false);
      closePage();
      expect(tokens[0].isCancellationRequested).toBe(true);
    });
  });
});

/** A lineage panel resolved on a fake view, with the postMessage of that view's page. */
function resolvedLineage() {
  const built = lineagePanel(silentLog()) as any;
  const page = openPage(built, fakeView(), false);
  return { panel: built, postMessage: page.page.webview.postMessage as Mock };
}

describe("LineagePanel — after a save", () => {
  it("tells the webview when the current project's manifest is replaced", () => {
    const { panel, postMessage } = resolvedLineage();
    panel.dbtLineageService = { columnsNeedStrict: () => undefined };
    const current = {
      projectRoot: { fsPath: "/p" },
      throwDiagnosticsErrorIfAvailable: vi.fn(),
      graphNotice: () => undefined,
      manifest: { publicationEpoch: 1 } as any,
    };
    const other = { manifest: { publicationEpoch: 1 } as any } as any;
    panel.queryManifestService = {
      getProject: () => current,
      manifestFor: () => current?.manifest,
      getEventByCurrentProject: () => undefined,
    };

    panel.manifestChanged(current as any);
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ command: "render" }),
    );
    other.manifest = { publicationEpoch: 2 };
    panel.manifestChanged(other);
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ command: "render" }),
    );
    current.manifest = { publicationEpoch: 2 };
    panel.manifestChanged(current as any);
    expect(postMessage).toHaveBeenLastCalledWith({ command: "projectSaved" });
  });

  it.each([
    ["equal", 3, 3],
    ["different", 3, 7],
  ])(
    "re-renders on a project switch with %s epochs",
    (_label, epochA, epochB) => {
      const { panel, postMessage } = resolvedLineage();
      panel.dbtLineageService = { columnsNeedStrict: () => undefined };
      const project = (root: string, publicationEpoch: number) => ({
        projectRoot: { fsPath: root },
        throwDiagnosticsErrorIfAvailable: vi.fn(),
        graphNotice: () => undefined,
        manifest: { publicationEpoch } as any,
      });
      const a = project("/a", epochA);
      const b = project("/b", epochB);
      let current: any = a;
      panel.queryManifestService = {
        getProject: () => current,
        manifestFor: () => current?.manifest,
        getEventByCurrentProject: () => undefined,
      };

      panel.manifestChanged(a as any);
      current = b;
      panel.manifestChanged(b as any);
      expect(postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ command: "render" }),
      );
      b.manifest = { publicationEpoch: epochB + 1 };
      panel.manifestChanged(b as any);
      expect(postMessage).toHaveBeenLastCalledWith({ command: "projectSaved" });
    },
  );
});

describe("LineagePanel — source YAML rooting", () => {
  let panel: LineagePanel;
  let postMessage: Mock;

  // Build a fake TextEditor over a source YAML body.
  const makeEditor = (filePath: string, body: string, cursorLine = 0) => {
    const lines = body.split("\n");
    return {
      document: {
        fileName: filePath,
        uri: { fsPath: filePath, path: filePath },
        lineCount: lines.length,
        lineAt: (line: number) => ({ text: lines[line] ?? "" }),
        getText: () => body,
      },
      selection: { active: { line: cursorLine } },
    };
  };

  const sourceTable = (source: string, name: string, filePath: string) => ({
    unique_id: `source.proj.${source}.${name}`,
    name,
    identifier: name,
    path: filePath,
    description: "",
    columns: {},
  });

  const makeEvent = (sourceMetaMap: Map<string, any>) => ({
    event: {
      sourceMetaMap,
      nodeMetaMap: { lookupByBaseName: vi.fn().mockReturnValue(undefined) },
      functionMetaMap: new Map(),
    },
  });

  beforeEach(() => {
    panel = lineagePanel(silentLog(), {
      dbtLineageService: {
        columnsNeedStrict: () => undefined,
        createTable: vi.fn((_e: unknown, _u: unknown, key: string) => ({
          table: key,
        })),
      },
    });
    postMessage = openPage(panel, fakeView(), false).page.webview.postMessage;
    (window as any).activeTextEditor = undefined;
  });

  afterEach(() => {
    (window as any).activeTextEditor = undefined;
  });

  it("builds the source.<pkg>.<source>.<table> key for tables in a file", () => {
    const filePath = "/proj/models/sources/identifies.yml";
    const sourceMetaMap = new Map([
      [
        "segment_website_production",
        {
          package_name: "proj",
          name: "segment_website_production",
          tables: [
            sourceTable("segment_website_production", "identifies", filePath),
          ],
        },
      ],
    ]);
    const matches = resolveSourceStartingNode(
      { sourceMetaMap } as never,
      makeEditor(filePath, "") as never,
    );
    expect(matches?.key).toBe(
      "source.proj.segment_website_production.identifies",
    );
  });

  it("roots automatically at the only source table in the file", () => {
    const filePath = "/proj/models/sources/identifies.yml";
    const sourceMetaMap = new Map([
      [
        "segment_website_production",
        {
          package_name: "proj",
          name: "segment_website_production",
          tables: [
            sourceTable("segment_website_production", "identifies", filePath),
          ],
        },
      ],
    ]);
    (panel as any).queryManifestService = {
      getEventByCurrentProject: vi
        .fn()
        .mockReturnValue(makeEvent(sourceMetaMap)),
      getProject: vi.fn().mockReturnValue(undefined),
      manifestFor: vi.fn().mockReturnValue(undefined),
    };
    (window as any).activeTextEditor = makeEditor(
      filePath,
      "sources:\n  - name: segment_website_production\n    tables:\n      - name: identifies\n",
    );

    const result = (panel as any).getStartingNode();

    expect(result.node).toEqual({
      table: "source.proj.segment_website_production.identifies",
    });
    expect((panel as any).dbtLineageService.createTable).toHaveBeenCalledWith(
      expect.anything(),
      filePath,
      "source.proj.segment_website_production.identifies",
    );
  });

  it("roots the same way for a .yaml file (not just .yml)", () => {
    const filePath = "/proj/models/sources/identifies.yaml";
    const sourceMetaMap = new Map([
      [
        "segment_website_production",
        {
          package_name: "proj",
          name: "segment_website_production",
          tables: [
            sourceTable("segment_website_production", "identifies", filePath),
          ],
        },
      ],
    ]);
    (panel as any).queryManifestService = {
      getEventByCurrentProject: vi
        .fn()
        .mockReturnValue(makeEvent(sourceMetaMap)),
      getProject: vi.fn().mockReturnValue(undefined),
      manifestFor: vi.fn().mockReturnValue(undefined),
    };
    (window as any).activeTextEditor = makeEditor(
      filePath,
      "sources:\n  - name: segment_website_production\n    tables:\n      - name: identifies\n",
    );

    const result = (panel as any).getStartingNode();

    expect(result.node).toEqual({
      table: "source.proj.segment_website_production.identifies",
    });
    expect((panel as any).dbtLineageService.createTable).toHaveBeenCalledWith(
      expect.anything(),
      filePath,
      "source.proj.segment_website_production.identifies",
    );
  });

  it("picks the source table the cursor sits within when the file has many", () => {
    const filePath = "/proj/models/sources/multi.yml";
    const body = [
      "sources:",
      "  - name: seg",
      "    tables:",
      "      - name: identifies", // line 3
      "      - name: tracks", //      line 4
      "      - name: pages", //       line 5
    ].join("\n");
    const sourceMetaMap = new Map([
      [
        "seg",
        {
          package_name: "proj",
          name: "seg",
          tables: [
            sourceTable("seg", "identifies", filePath),
            sourceTable("seg", "tracks", filePath),
            sourceTable("seg", "pages", filePath),
          ],
        },
      ],
    ]);
    (panel as any).queryManifestService = {
      getEventByCurrentProject: vi
        .fn()
        .mockReturnValue(makeEvent(sourceMetaMap)),
      getProject: vi.fn().mockReturnValue(undefined),
      manifestFor: vi.fn().mockReturnValue(undefined),
    };
    // Cursor on line 4 → the "tracks" table.
    (window as any).activeTextEditor = makeEditor(filePath, body, 4);

    const result = (panel as any).getStartingNode();

    expect(result.node).toEqual({ table: "source.proj.seg.tracks" });
  });

  it("falls back to the first table when the cursor is above every declaration", () => {
    const filePath = "/proj/models/sources/multi.yml";
    const body = [
      "sources:",
      "  - name: seg",
      "    tables:",
      "      - name: identifies",
      "      - name: tracks",
    ].join("\n");
    const sourceMetaMap = new Map([
      [
        "seg",
        {
          package_name: "proj",
          name: "seg",
          tables: [
            sourceTable("seg", "identifies", filePath),
            sourceTable("seg", "tracks", filePath),
          ],
        },
      ],
    ]);
    (panel as any).queryManifestService = {
      getEventByCurrentProject: vi
        .fn()
        .mockReturnValue(makeEvent(sourceMetaMap)),
      getProject: vi.fn().mockReturnValue(undefined),
      manifestFor: vi.fn().mockReturnValue(undefined),
    };
    // Cursor on line 0 (the `sources:` line), above any table name.
    (window as any).activeTextEditor = makeEditor(filePath, body, 0);

    const result = (panel as any).getStartingNode();

    expect(result.node).toEqual({ table: "source.proj.seg.identifies" });
  });

  it("does not mistake a source-level name for a table declaration", () => {
    const filePath = "/proj/models/sources/pages.yml";
    // The SOURCE is named "pages" and one of its TABLES is also named
    // "pages". With a plain line regex the source-level `- name: pages`
    // (line 1) would anchor the table, so a cursor on the `tables:` line
    // (line 2) would wrongly pick "pages"; the AST walk only sees table
    // declarations, so nothing is at-or-above the cursor and the panel
    // falls back to the file's first table.
    const body = [
      "sources:",
      "  - name: pages",
      "    tables:",
      "      - name: identifies",
      "      - name: pages",
    ].join("\n");
    const sourceMetaMap = new Map([
      [
        "pages",
        {
          package_name: "proj",
          name: "pages",
          tables: [
            sourceTable("pages", "identifies", filePath),
            sourceTable("pages", "pages", filePath),
          ],
        },
      ],
    ]);
    (panel as any).queryManifestService = {
      getEventByCurrentProject: vi
        .fn()
        .mockReturnValue(makeEvent(sourceMetaMap)),
      getProject: vi.fn().mockReturnValue(undefined),
      manifestFor: vi.fn().mockReturnValue(undefined),
    };
    (window as any).activeTextEditor = makeEditor(filePath, body, 2);

    const result = (panel as any).getStartingNode();

    expect(result.node).toEqual({ table: "source.proj.pages.identifies" });
  });

  it("disambiguates the same table name declared under two sources in one file", () => {
    const filePath = "/proj/models/sources/events.yml";
    const body = [
      "sources:",
      "  - name: seg",
      "    tables:",
      "      - name: events", // line 3
      "  - name: ga",
      "    tables:",
      "      - name: events", // line 6
    ].join("\n");
    const sourceMetaMap = new Map([
      [
        "seg",
        {
          package_name: "proj",
          name: "seg",
          tables: [sourceTable("seg", "events", filePath)],
        },
      ],
      [
        "ga",
        {
          package_name: "proj",
          name: "ga",
          tables: [sourceTable("ga", "events", filePath)],
        },
      ],
    ]);
    (panel as any).queryManifestService = {
      getEventByCurrentProject: vi
        .fn()
        .mockReturnValue(makeEvent(sourceMetaMap)),
      getProject: vi.fn().mockReturnValue(undefined),
      manifestFor: vi.fn().mockReturnValue(undefined),
    };
    // Cursor on line 6 → ga's "events", not seg's (a name-only lookup
    // would find seg's declaration line for both candidates).
    (window as any).activeTextEditor = makeEditor(filePath, body, 6);

    const result = (panel as any).getStartingNode();

    expect(result.node).toEqual({ table: "source.proj.ga.events" });
  });

  it("records lastRenderedSourceKey even when createTable returns undefined", () => {
    const filePath = "/proj/models/sources/identifies.yml";
    const sourceMetaMap = new Map([
      [
        "seg",
        {
          package_name: "proj",
          name: "seg",
          tables: [sourceTable("seg", "identifies", filePath)],
        },
      ],
    ]);
    (panel as any).queryManifestService = {
      getEventByCurrentProject: vi
        .fn()
        .mockReturnValue(makeEvent(sourceMetaMap)),
      getProject: vi.fn().mockReturnValue(undefined),
      manifestFor: vi.fn().mockReturnValue(undefined),
    };
    (panel as any).dbtLineageService = {
      createTable: vi.fn().mockReturnValue(undefined),
    };
    (window as any).activeTextEditor = makeEditor(
      filePath,
      "sources:\n  - name: seg\n    tables:\n      - name: identifies\n",
    );

    (panel as any).getStartingNode();

    // The selection guard compares against this key; leaving it undefined on
    // a failed createTable would re-trigger a full render on every cursor
    // move until the service call succeeds.
    expect((panel as any).lastRenderedSourceKey).toBe(
      "source.proj.seg.identifies",
    );
  });

  it("resolves the source only once per cursor-move render", () => {
    const filePath = "/proj/models/sources/identifies.yml";
    const sourceMetaMap = new Map([
      [
        "seg",
        {
          package_name: "proj",
          name: "seg",
          tables: [sourceTable("seg", "identifies", filePath)],
        },
      ],
    ]);
    (panel as any).queryManifestService = {
      getEventByCurrentProject: vi
        .fn()
        .mockReturnValue(makeEvent(sourceMetaMap)),
      getProject: vi.fn().mockReturnValue(undefined),
      manifestFor: vi.fn().mockReturnValue(undefined),
    };
    const editor = makeEditor(
      filePath,
      "sources:\n  - name: seg\n    tables:\n      - name: identifies\n",
      3,
    );
    (window as any).activeTextEditor = editor;
    const lookups = vi.spyOn(sourceMetaMap, "values");

    (panel as any).changedTextEditorSelection(editor);

    // The guard's resolution is threaded into the render path; without the
    // threading this is 2 (guard + getStartingNode), iterating
    // sourceMetaMap twice per cursor move.
    expect(lookups).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "render",
        args: expect.objectContaining({
          node: { table: "source.proj.seg.identifies" },
        }),
      }),
    );
  });

  it("shows the missing-lineage message for a YAML that defines no source in this file", () => {
    const filePath = "/proj/models/staging/schema.yml";
    // The only source lives in a different file.
    const sourceMetaMap = new Map([
      [
        "seg",
        {
          package_name: "proj",
          name: "seg",
          tables: [
            sourceTable("seg", "identifies", "/proj/models/sources/other.yml"),
          ],
        },
      ],
    ]);
    (panel as any).queryManifestService = {
      getEventByCurrentProject: vi
        .fn()
        .mockReturnValue(makeEvent(sourceMetaMap)),
      getProject: vi.fn().mockReturnValue(undefined),
      manifestFor: vi.fn().mockReturnValue(undefined),
    };
    (window as any).activeTextEditor = makeEditor(
      filePath,
      "models:\n  - name: stg_orders\n",
    );

    const result = (panel as any).getStartingNode();

    expect(result.node).toBeUndefined();
    expect(result.missingLineageMessage).toEqual(
      expect.objectContaining({ type: "warning" }),
    );
    expect((panel as any).dbtLineageService.createTable).not.toHaveBeenCalled();
  });
});
