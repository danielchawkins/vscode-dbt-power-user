import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { window, workspace } from "vscode";
import { LineagePanel } from "../../webview_provider/lineagePanel";

describe("LineagePanel", () => {
  let panel: LineagePanel;
  let mockPostMessage: jest.Mock;

  beforeEach(() => {
    mockPostMessage = jest.fn();

    // Create a minimal instance by bypassing the constructor DI.
    // We only need the methods under test and the _panel webview stub.
    panel = Object.create(LineagePanel.prototype);

    // Stub the internal webview panel so postMessage is captured.
    (panel as any)._panel = {
      webview: { postMessage: mockPostMessage },
    };

    // Stub dependencies used by getStartingNode / renderStartingNode
    (panel as any).queryManifestService = {
      getEventByCurrentProject: jest.fn().mockReturnValue(undefined),
      getProject: jest.fn().mockReturnValue(undefined),
    };
    (panel as any).dbtTerminal = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
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
        get: jest
          .fn<any>()
          .mockImplementation((key: string) =>
            key === "lineage.defaultExpansion" ? 10 : undefined,
          ),
      };
      (workspace.getConfiguration as jest.Mock).mockReturnValue(mockConfig);

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
        get: jest
          .fn<any>()
          .mockImplementation((key: string) =>
            key === "lineage.defaultExpansion" ? 3 : undefined,
          ),
      };
      (workspace.getConfiguration as jest.Mock).mockReturnValue(mockConfig);

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
    const getInferredColumns = jest
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
    const getColumnsOfModel = jest.fn();
    const mergeColumnsFromDB = jest.fn();
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
      getInferredColumns: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue([{ name: "id", datatype: "integer" }]),
    };
    (window.withProgress as jest.Mock).mockClear();

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
    const getColumnsOfSource = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue([{ column: "id", dtype: "INTEGER" }]);
    const mergeColumnsFromDB = jest.fn((t: any, _columns: unknown) => {
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
    (window.withProgress as jest.Mock).mockImplementation(
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

  it("answers childTables with children and parentTables with parents", async () => {
    const getChildTables = jest
      .fn<(...args: any[]) => any>()
      .mockReturnValue({ tables: [{ table: "child" }] });
    const getParentTables = jest
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
        id: "up",
        syncRequestId: "up",
        body: { tables: [{ table: "child" }] },
        status: true,
      },
    });
    expect(mockPostMessage).toHaveBeenCalledWith({
      command: "response",
      args: {
        id: "down",
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
    const getConnectedColumns = jest
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
        id: "cll-1",
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
      getConnectedColumns: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue({ kind: "noLineage", reason }),
    };

    await (panel as any).handleCommand({
      command: "getConnectedColumns",
      args: { params: { targets: [["model.p.a", "id"]] } },
      syncRequestId: "cll-2",
    });

    const body = (mockPostMessage.mock.calls[0][0] as any).args.body;
    expect(body.column_lineage).toEqual([]);
    expect(Object.keys(body.errors)).toEqual(["model.p.a"]);
    expect(body.errors["model.p.a"][0]).toContain(expected);
  });

  it("keeps lineage and reports each failed column", async () => {
    (panel as any).dbtLineageService = {
      getConnectedColumns: jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue({
          kind: "lineage",
          columnLineage: [],
          failures: [{ target: ["model.p.x", "y"], message: "timeout" }],
        }),
    };

    await (panel as any).handleCommand({
      command: "getConnectedColumns",
      args: { params: { targets: [["model.p.x", "y"]] } },
      syncRequestId: "cll-3",
    });

    const body = (mockPostMessage.mock.calls[0][0] as any).args.body;
    expect(body.errors).toEqual({
      "model.p.x": ["Could not read column lineage for y: timeout"],
    });
  });
});

describe("LineagePanel — after a save", () => {
  it("tells the webview when the current project's manifest is replaced", () => {
    const panel = Object.create(LineagePanel.prototype);
    const postMessage = jest.fn();
    (panel as any)._panel = { webview: { postMessage } };
    (panel as any).dbtTerminal = { info: jest.fn(), error: jest.fn() };
    const current = {
      projectRoot: { fsPath: "/p" },
      throwDiagnosticsErrorIfAvailable: jest.fn(),
      manifest: { publicationEpoch: 1 } as any,
    };
    const other = { manifest: { publicationEpoch: 1 } as any } as any;
    (panel as any).queryManifestService = {
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
      const postMessage = jest.fn();
      (panel as any)._panel = { webview: { postMessage } };
      (panel as any).dbtTerminal = { info: jest.fn(), error: jest.fn() };
      const project = (root: string, publicationEpoch: number) => ({
        projectRoot: { fsPath: root },
        throwDiagnosticsErrorIfAvailable: jest.fn(),
        manifest: { publicationEpoch } as any,
      });
      const a = project("/a", epochA);
      const b = project("/b", epochB);
      let current: any = a;
      (panel as any).queryManifestService = {
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
      nodeMetaMap: { lookupByBaseName: jest.fn().mockReturnValue(undefined) },
      functionMetaMap: new Map(),
    },
  });

  beforeEach(() => {
    panel = Object.create(LineagePanel.prototype);
    (panel as any)._panel = { webview: { postMessage: jest.fn() } };
    (panel as any).dbtTerminal = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    };
    (panel as any).dbtLineageService = {
      createTable: jest.fn((_e: unknown, _u: unknown, key: string) => ({
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
      getEventByCurrentProject: jest
        .fn()
        .mockReturnValue(makeEvent(sourceMetaMap)),
      getProject: jest.fn().mockReturnValue(undefined),
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
      getEventByCurrentProject: jest
        .fn()
        .mockReturnValue(makeEvent(sourceMetaMap)),
      getProject: jest.fn().mockReturnValue(undefined),
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
      getEventByCurrentProject: jest
        .fn()
        .mockReturnValue(makeEvent(sourceMetaMap)),
      getProject: jest.fn().mockReturnValue(undefined),
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
      getEventByCurrentProject: jest
        .fn()
        .mockReturnValue(makeEvent(sourceMetaMap)),
      getProject: jest.fn().mockReturnValue(undefined),
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
      getEventByCurrentProject: jest
        .fn()
        .mockReturnValue(makeEvent(sourceMetaMap)),
      getProject: jest.fn().mockReturnValue(undefined),
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
      getEventByCurrentProject: jest
        .fn()
        .mockReturnValue(makeEvent(sourceMetaMap)),
      getProject: jest.fn().mockReturnValue(undefined),
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
      getEventByCurrentProject: jest
        .fn()
        .mockReturnValue(makeEvent(sourceMetaMap)),
      getProject: jest.fn().mockReturnValue(undefined),
    };
    (panel as any).dbtLineageService = {
      createTable: jest.fn().mockReturnValue(undefined),
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
      getEventByCurrentProject: jest
        .fn()
        .mockReturnValue(makeEvent(sourceMetaMap)),
      getProject: jest.fn().mockReturnValue(undefined),
    };
    const editor = makeEditor(
      filePath,
      "sources:\n  - name: seg\n    tables:\n      - name: identifies\n",
      3,
    );
    (window as any).activeTextEditor = editor;
    const resolveSpy = jest.spyOn(
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
      getEventByCurrentProject: jest
        .fn()
        .mockReturnValue(makeEvent(sourceMetaMap)),
      getProject: jest.fn().mockReturnValue(undefined),
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

  it("getStartingNode keeps the lineage component's relationship features enabled", () => {
    (panel as any).queryManifestService = {
      getEventByCurrentProject: jest.fn().mockReturnValue(undefined),
      getProject: jest.fn().mockReturnValue(undefined),
    };

    const result = (panel as any).getStartingNode();

    expect(result.aiEnabled).toBe(true);
  });
});
