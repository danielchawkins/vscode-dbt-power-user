import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { window, workspace } from "vscode";
import { LineagePanel } from "../../features/lineage/lineagePanel";

describe("LineagePanel", () => {
  let panel: LineagePanel;
  let mockPostMessage: Mock;

  beforeEach(() => {
    mockPostMessage = vi.fn();

    // Create a minimal instance by bypassing the constructor DI.
    // We only need the methods under test and the _panel webview stub.
    panel = Object.create(LineagePanel.prototype);

    // Stub the internal webview panel so postMessage is captured.
    (panel as any)._panel = {
      webview: { postMessage: mockPostMessage },
    };

    // Stub dependencies used by getStartingNode / renderStartingNode
    (panel as any).queryManifestService = {
      getEventByCurrentProject: vi.fn().mockReturnValue(undefined),
      getProject: vi.fn().mockReturnValue(undefined),
    };
    (panel as any).dbtTerminal = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const globalState = new Map<string, unknown>();
    (panel as any).extensionContext = {
      getFromGlobalState: (key: string) => globalState.get(key),
      setToGlobalState: (key: string, value: unknown) =>
        globalState.set(key, value),
    };
  });

  describe("manifestChanged", () => {
    it("should re-render the starting node when a manifest changes", () => {
      panel.manifestChanged(undefined);

      // renderStartingNode posts a "render" command to the webview
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: "render" }),
      );
    });

    it("should not throw when panel is not visible", () => {
      (panel as any)._panel = undefined;

      expect(() => panel.manifestChanged(undefined)).not.toThrow();
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

      // Call handleCommand with getLineageSettings
      await (panel as any).handleCommand({
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

      await (panel as any).handleCommand({
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

    const body = await (panel as any).getColumns({
      table: "model.p.a",
      refresh: false,
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
        getColumnsOfModel,
        mergeColumnsFromDB,
      }),
    };
    (panel as any).dbtLineageService = {
      getInferredColumns: vi
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue([{ name: "id", datatype: "integer" }]),
    };
    (window.withProgress as Mock).mockClear();

    const body = await (panel as any).getColumns({
      table: "model.p.a",
      refresh: true,
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
      getProject: () => ({ getColumnsOfSource, mergeColumnsFromDB }),
    };
    (window.withProgress as Mock).mockImplementation(
      async (_opts: any, task: any) => task(),
    );

    const body = await (panel as any).getColumns({
      table: "source.p.raw.orders",
      refresh: true,
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

    await (panel as any).handleCommand({
      command: "persistLineageSettings",
      args: { params: { showSelectEdges: false, showNonSelectEdges: true } },
      syncRequestId: "p",
    });
    await (panel as any).handleCommand({
      command: "getLineageSettings",
      args: {},
      syncRequestId: "g",
    });

    expect(mockPostMessage).toHaveBeenLastCalledWith({
      command: "response",
      args: {
        syncRequestId: "g",
        body: {
          showSelectEdges: false,
          showNonSelectEdges: true,
          defaultExpansion: 3,
        },
        status: true,
      },
    });
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
      await (panel as any).handleCommand({
        command: "persistLineageSettings",
        args: {
          params: {
            showRefs: false,
            inferenceConfidenceThreshold: threshold,
            sqlText: "select secret",
          },
        },
        syncRequestId,
      });
      await (panel as any).handleCommand({
        command: "getLineageSettings",
        syncRequestId: "g",
      });
      expect(mockPostMessage.mock.lastCall![0].args.body).toEqual({
        showSelectEdges: true,
        showNonSelectEdges: false,
        showRefs: false,
        inferenceConfidenceThreshold: threshold > 1 ? 1 : 0,
        defaultExpansion: 3,
      });
    }
  });

  it("answers a malformed request with a failed response the component matches by id", async () => {
    await (panel as any).handleCommand({
      command: "childTables",
      args: { params: { table: 1 } },
      syncRequestId: "bad",
    });

    expect(mockPostMessage).toHaveBeenCalledWith({
      command: "response",
      args: {
        syncRequestId: "bad",
        body: undefined,
        status: false,
        error: "Malformed request",
      },
    });
  });

  it("answers childTables with children and parentTables with parents", async () => {
    const getChildTables = vi
      .fn<(...args: any[]) => any>()
      .mockReturnValue({ tables: [{ table: "child" }] });
    const getParentTables = vi
      .fn<(...args: any[]) => any>()
      .mockReturnValue({ tables: [{ table: "parent" }] });
    (panel as any).dbtLineageService = { getChildTables, getParentTables };
    const params = { table: "model.p.a" };

    await (panel as any).handleCommand({
      command: "childTables",
      args: { params },
      syncRequestId: "up",
    });
    await (panel as any).handleCommand({
      command: "parentTables",
      args: { params },
      syncRequestId: "down",
    });

    expect(getChildTables).toHaveBeenCalledWith(params);
    expect(getParentTables).toHaveBeenCalledWith(params);
    expect(mockPostMessage).toHaveBeenCalledWith({
      command: "response",
      args: {
        syncRequestId: "up",
        body: { tables: [{ table: "child" }] },
        status: true,
      },
    });
    expect(mockPostMessage).toHaveBeenCalledWith({
      command: "response",
      args: {
        syncRequestId: "down",
        body: { tables: [{ table: "parent" }] },
        status: true,
      },
    });
  });

  it("answers getConnectedColumns with the service's lineage", async () => {
    const lineage = [
      {
        source: ["model.p.a", "id"],
        target: ["model.p.b", "id"],
        type: "direct",
        viewsType: "Unchanged",
      },
    ];
    const getConnectedColumns = vi
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue({ kind: "lineage", columnLineage: lineage });
    (panel as any).dbtLineageService = { getConnectedColumns };

    await (panel as any).handleCommand({
      command: "getConnectedColumns",
      args: {
        params: { targets: [["model.p.b", "id"]], upstreamExpansion: true },
      },
      syncRequestId: "cll-1",
    });

    expect(getConnectedColumns).toHaveBeenCalledWith({
      targets: [["model.p.b", "id"]],
      upstreamExpansion: true,
    });
    expect(mockPostMessage).toHaveBeenCalledWith({
      command: "response",
      args: {
        syncRequestId: "cll-1",
        body: { column_lineage: lineage },
        status: true,
      },
    });
  });

  it.each([
    [{ kind: "empty" }, "no recorded column lineage"],
    [
      { kind: "staticAnalysis", mode: "baseline" },
      "fusionPowerUser.staticAnalysis",
    ],
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

    await (panel as any).handleCommand({
      command: "getConnectedColumns",
      args: {
        params: { targets: [["model.p.a", "id"]], upstreamExpansion: true },
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

    await (panel as any).handleCommand({
      command: "getConnectedColumns",
      args: {
        params: { targets: [["model.p.x", "y"]], upstreamExpansion: false },
      },
      syncRequestId: "cll-3",
    });

    const body = mockPostMessage.mock.calls[0][0].args.body;
    expect(body.errors).toEqual({
      "model.p.x": ["Could not read column lineage for y: timeout"],
    });
  });
});

describe("LineagePanel — after a save", () => {
  it("tells the webview when the current project's manifest is replaced", () => {
    const panel = Object.create(LineagePanel.prototype);
    const postMessage = vi.fn();
    panel._panel = { webview: { postMessage } };
    panel.dbtTerminal = { info: vi.fn(), error: vi.fn() };
    const current = {
      projectRoot: { fsPath: "/p" },
      throwDiagnosticsErrorIfAvailable: vi.fn(),
      manifest: { publicationEpoch: 1 } as any,
    };
    const other = { manifest: { publicationEpoch: 1 } as any } as any;
    panel.queryManifestService = {
      getProject: () => current,
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
      const panel = Object.create(LineagePanel.prototype);
      const postMessage = vi.fn();
      panel._panel = { webview: { postMessage } };
      panel.dbtTerminal = { info: vi.fn(), error: vi.fn() };
      const project = (root: string, publicationEpoch: number) => ({
        projectRoot: { fsPath: root },
        throwDiagnosticsErrorIfAvailable: vi.fn(),
        manifest: { publicationEpoch } as any,
      });
      const a = project("/a", epochA);
      const b = project("/b", epochB);
      let current: any = a;
      panel.queryManifestService = {
        getProject: () => current,
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

  const sourceTable = (name: string, filePath: string) => ({
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
    panel = Object.create(LineagePanel.prototype);
    (panel as any)._panel = { webview: { postMessage: vi.fn() } };
    (panel as any).dbtTerminal = {
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    };
    (panel as any).dbtLineageService = {
      createTable: vi.fn((_e: unknown, _u: unknown, key: string) => ({
        table: key,
      })),
    };
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
          tables: [sourceTable("identifies", filePath)],
        },
      ],
    ]);
    const matches = (panel as any).getSourceTablesForFile(
      sourceMetaMap,
      filePath,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].key).toBe(
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
          tables: [sourceTable("identifies", filePath)],
        },
      ],
    ]);
    (panel as any).queryManifestService = {
      getEventByCurrentProject: vi
        .fn()
        .mockReturnValue(makeEvent(sourceMetaMap)),
      getProject: vi.fn().mockReturnValue(undefined),
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
          tables: [sourceTable("identifies", filePath)],
        },
      ],
    ]);
    (panel as any).queryManifestService = {
      getEventByCurrentProject: vi
        .fn()
        .mockReturnValue(makeEvent(sourceMetaMap)),
      getProject: vi.fn().mockReturnValue(undefined),
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
            sourceTable("identifies", filePath),
            sourceTable("tracks", filePath),
            sourceTable("pages", filePath),
          ],
        },
      ],
    ]);
    (panel as any).queryManifestService = {
      getEventByCurrentProject: vi
        .fn()
        .mockReturnValue(makeEvent(sourceMetaMap)),
      getProject: vi.fn().mockReturnValue(undefined),
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
            sourceTable("identifies", filePath),
            sourceTable("tracks", filePath),
          ],
        },
      ],
    ]);
    (panel as any).queryManifestService = {
      getEventByCurrentProject: vi
        .fn()
        .mockReturnValue(makeEvent(sourceMetaMap)),
      getProject: vi.fn().mockReturnValue(undefined),
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
            sourceTable("identifies", filePath),
            sourceTable("pages", filePath),
          ],
        },
      ],
    ]);
    (panel as any).queryManifestService = {
      getEventByCurrentProject: vi
        .fn()
        .mockReturnValue(makeEvent(sourceMetaMap)),
      getProject: vi.fn().mockReturnValue(undefined),
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
          tables: [sourceTable("events", filePath)],
        },
      ],
      [
        "ga",
        {
          package_name: "proj",
          name: "ga",
          tables: [sourceTable("events", filePath)],
        },
      ],
    ]);
    (panel as any).queryManifestService = {
      getEventByCurrentProject: vi
        .fn()
        .mockReturnValue(makeEvent(sourceMetaMap)),
      getProject: vi.fn().mockReturnValue(undefined),
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
          tables: [sourceTable("identifies", filePath)],
        },
      ],
    ]);
    (panel as any).queryManifestService = {
      getEventByCurrentProject: vi
        .fn()
        .mockReturnValue(makeEvent(sourceMetaMap)),
      getProject: vi.fn().mockReturnValue(undefined),
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
          tables: [sourceTable("identifies", filePath)],
        },
      ],
    ]);
    (panel as any).queryManifestService = {
      getEventByCurrentProject: vi
        .fn()
        .mockReturnValue(makeEvent(sourceMetaMap)),
      getProject: vi.fn().mockReturnValue(undefined),
    };
    const editor = makeEditor(
      filePath,
      "sources:\n  - name: seg\n    tables:\n      - name: identifies\n",
      3,
    );
    (window as any).activeTextEditor = editor;
    const resolveSpy = vi.spyOn(
      panel as any,
      "resolveSourceStartingNode" as any,
    );

    (panel as any).changedTextEditorSelection(editor);

    // The guard's resolution is threaded into the render path; without the
    // threading this is 2 (guard + getStartingNode), iterating
    // sourceMetaMap twice per cursor move.
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect((panel as any)._panel.webview.postMessage).toHaveBeenCalledWith(
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
          tables: [sourceTable("identifies", "/proj/models/sources/other.yml")],
        },
      ],
    ]);
    (panel as any).queryManifestService = {
      getEventByCurrentProject: vi
        .fn()
        .mockReturnValue(makeEvent(sourceMetaMap)),
      getProject: vi.fn().mockReturnValue(undefined),
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
