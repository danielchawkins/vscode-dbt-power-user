import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { CancellationTokenSource, window } from "vscode";
import {
  ColumnLineageCompute,
  DbtLineageService,
} from "../../services/dbtLineageService";

// Minimal NodeData-shaped edge.
function node(key: string, edgeType?: "data" | "constraint") {
  return { label: key, key, resourceType: "model", edgeType };
}

// Builds a DbtLineageService with the DI bypassed, a stubbed event carrying the
// given graphMetaMap, and createTable stubbed to a minimal { table: key }.
function makeService(graphMetaMap: any): DbtLineageService {
  const svc = Object.create(DbtLineageService.prototype) as DbtLineageService;
  (svc as any).queryManifestService = {
    getEventByCurrentProject: () => ({ event: { graphMetaMap } }),
  };
  (svc as any).createTable = (
    _e: unknown,
    _url: string | undefined,
    key: string,
  ) => ({
    table: key,
  });
  return svc;
}

describe("DbtLineageService — foreign-key-only edge hiding", () => {
  it("getUpstreamTables hides constraint edges and keeps data edges", () => {
    // upstream reads the `children` map
    const children = new Map([
      [
        "model.p.fact",
        {
          nodes: [
            node("model.p.int", "data"),
            node("model.p.dim", "constraint"),
          ],
        },
      ],
    ]);
    const svc = makeService({ children, parents: new Map() });

    const tables = svc
      .getUpstreamTables({ table: "model.p.fact" })
      .tables!.map((t) => t.table);
    expect(tables).toContain("model.p.int");
    expect(tables).not.toContain("model.p.dim");
  });

  it("getDownstreamTables hides constraint edges", () => {
    // downstream reads the `parents` map
    const parents = new Map([
      ["model.p.dim", { nodes: [node("model.p.fact", "constraint")] }],
      ["model.p.int", { nodes: [node("model.p.fact", "data")] }],
    ]);
    const svc = makeService({ parents, children: new Map() });

    // fact is only a constraint-child of dim → dim has no data-flow downstream
    expect(svc.getDownstreamTables({ table: "model.p.dim" }).tables).toEqual(
      [],
    );
    // but it's a real downstream of int
    expect(
      svc
        .getDownstreamTables({ table: "model.p.int" })
        .tables!.map((t) => t.table),
    ).toEqual(["model.p.fact"]);
  });

  it("treats untagged edges (no edgeType) as data-flow", () => {
    const children = new Map([
      ["model.p.fact", { nodes: [node("model.p.int")] }],
    ]);
    const svc = makeService({ children, parents: new Map() });
    expect(
      svc
        .getUpstreamTables({ table: "model.p.fact" })
        .tables!.map((t) => t.table),
    ).toEqual(["model.p.int"]);
  });

  it("getConnectedNodeCount excludes constraint edges", () => {
    const children = new Map([
      [
        "model.p.fact",
        {
          nodes: [
            node("model.p.int", "data"),
            node("model.p.dim", "constraint"),
          ],
        },
      ],
    ]);
    const svc = makeService({ children, parents: new Map() });
    const count = (svc as any).getConnectedNodeCount(children, "model.p.fact");
    expect(count).toBe(1);
  });
});

describe("DbtLineageService — getConnectedColumns local lineage", () => {
  let originalShowErrorMessage: any;
  let errorMessages: string[] = [];

  beforeEach(() => {
    errorMessages = [];
    originalShowErrorMessage = window.showErrorMessage;
    (window as any).showErrorMessage = jest.fn((msg: string) => {
      errorMessages.push(msg);
      return Promise.resolve(undefined);
    });
  });

  afterEach(() => {
    (window as any).showErrorMessage = originalShowErrorMessage;
  });

  function makeDBTProject(
    nodeNames: string[] = ["model.src", "model.parent"],
  ): unknown {
    const mappedNode: Record<string, unknown> = {};
    for (const name of nodeNames) {
      const parts = name.split(".");
      mappedNode[name] = {
        uniqueId: name,
        name: parts[parts.length - 1],
        columns: {},
        path: undefined,
      };
    }

    return {
      getAdapterType: jest.fn().mockReturnValue("postgres"),
      getNonEphemeralParents: jest.fn().mockReturnValue(["model.parent"]),
      getNodesWithDBColumns: (jest.fn() as any).mockResolvedValue({
        mappedNode,
        relationsWithoutColumns: [],
        mappedCompiledSql: {},
      }),
      getBulkCompiledSql: (jest.fn() as any).mockResolvedValue({}),
    } as any;
  }

  function createServiceWithCompute(fakeCompute: ColumnLineageCompute): {
    svc: DbtLineageService;
    terminal: any;
    manifestService: any;
  } {
    const mockTerminal = {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const mockQueryManifestService = {
      getEventByCurrentProject: jest.fn(),
      getProject: jest.fn(),
    };
    const svc = new DbtLineageService(
      mockTerminal as any,
      mockQueryManifestService as any,
      fakeCompute,
    );
    return {
      svc,
      terminal: mockTerminal,
      manifestService: mockQueryManifestService,
    };
  }

  it("returns sentinel result unchanged on successful compute", async () => {
    const sentinelResult: any = {
      column_lineage: [
        {
          source: { uniqueId: "model.src", column_name: "id" },
          target: { uniqueId: "model.tgt", column_name: "id" },
          type: "direct",
        },
      ],
      confidence: 100,
    };

    const fakeCompute = jest
      .fn<ColumnLineageCompute>()
      .mockResolvedValue(sentinelResult);

    const { svc, manifestService } = createServiceWithCompute(fakeCompute);
    const mockProject = makeDBTProject();
    manifestService.getProject.mockReturnValue(mockProject);
    manifestService.getEventByCurrentProject.mockReturnValue({ event: {} });
    const cts = new CancellationTokenSource();

    const result = await svc.getConnectedColumns(
      {
        targets: [["model.src", "id"]],
        upstreamExpansion: false,
        currAnd1HopTables: ["model.src", "model.parent"],
        selectedColumn: { name: "id", table: "model.src" },
        showIndirectEdges: false,
      },
      cts,
    );

    expect(result).toBe(sentinelResult);
    expect(errorMessages).toHaveLength(0);
    expect(fakeCompute).toHaveBeenCalledTimes(1);
    const [dialect, modelInfos, options] = fakeCompute.mock.calls[0]!;
    expect(dialect).toBe("postgres");
    expect(modelInfos.map(({ model_node }) => model_node.uniqueId)).toEqual([
      "model.src",
      "model.parent",
    ]);
    expect(modelInfos[0]).toEqual(
      expect.objectContaining({ compiled_sql: undefined }),
    );
    for (const modelInfo of modelInfos) {
      expect(modelInfo).not.toHaveProperty("raw_sql");
    }
    expect(options).toEqual(
      expect.objectContaining({
        showIndirectEdges: false,
        isCancelled: expect.any(Function),
      }),
    );
  });

  it("returns undefined and shows error when compute returns null", async () => {
    const fakeCompute = jest.fn<ColumnLineageCompute>().mockResolvedValue(null);

    const { svc, terminal, manifestService } =
      createServiceWithCompute(fakeCompute);
    const mockProject = makeDBTProject();
    manifestService.getProject.mockReturnValue(mockProject);
    manifestService.getEventByCurrentProject.mockReturnValue({ event: {} });
    const cts = new CancellationTokenSource();

    const result = await svc.getConnectedColumns(
      {
        targets: [["model.src", "id"]],
        upstreamExpansion: false,
        currAnd1HopTables: ["model.src", "model.parent"],
        selectedColumn: { name: "id", table: "model.src" },
        showIndirectEdges: false,
      },
      cts,
    );

    expect(result).toBeUndefined();
    expect(errorMessages).toHaveLength(1);
    expect(errorMessages[0]).toContain("Unable to compute column lineage");
    expect(terminal.warn).toHaveBeenCalled();
  });

  it("returns undefined silently when cancelled after compute resolves", async () => {
    let resolveCompute: ((value: any) => void) | undefined;
    const computePromise = new Promise<any>((resolve) => {
      resolveCompute = resolve;
    });

    const fakeCompute = jest
      .fn<ColumnLineageCompute>()
      .mockReturnValue(computePromise);

    const { svc, manifestService } = createServiceWithCompute(fakeCompute);
    const mockProject = makeDBTProject();
    manifestService.getProject.mockReturnValue(mockProject);
    manifestService.getEventByCurrentProject.mockReturnValue({ event: {} });
    const cts = new CancellationTokenSource();

    const resultPromise = svc.getConnectedColumns(
      {
        targets: [["model.src", "id"]],
        upstreamExpansion: false,
        currAnd1HopTables: ["model.src", "model.parent"],
        selectedColumn: { name: "id", table: "model.src" },
        showIndirectEdges: false,
      },
      cts,
    );

    await new Promise((r) => setTimeout(r, 0));
    cts.cancel();
    resolveCompute!({ column_lineage: [] });

    const result = await resultPromise;

    expect(result).toBeUndefined();
    expect(errorMessages).toHaveLength(0);
    expect(fakeCompute).toHaveBeenCalledTimes(1);
  });

  it("reports local engine errors", async () => {
    const fakeCompute = jest
      .fn<ColumnLineageCompute>()
      .mockRejectedValue(new Error("engine failed"));
    const { svc, terminal, manifestService } =
      createServiceWithCompute(fakeCompute);
    manifestService.getProject.mockReturnValue(makeDBTProject());
    manifestService.getEventByCurrentProject.mockReturnValue({ event: {} });

    const result = await svc.getConnectedColumns(
      {
        targets: [["model.src", "id"]],
        upstreamExpansion: false,
        currAnd1HopTables: ["model.src", "model.parent"],
        selectedColumn: { name: "id", table: "model.src" },
        showIndirectEdges: false,
      },
      new CancellationTokenSource(),
    );

    expect(result).toBeUndefined();
    expect(errorMessages).toHaveLength(1);
    expect(errorMessages[0]).toContain("engine failed");
    expect(terminal.error).toHaveBeenCalled();
  });

  it("skips the engine when already cancelled", async () => {
    const fakeCompute = jest.fn<ColumnLineageCompute>();
    const { svc, manifestService } = createServiceWithCompute(fakeCompute);
    manifestService.getProject.mockReturnValue(makeDBTProject());
    manifestService.getEventByCurrentProject.mockReturnValue({ event: {} });
    const cts = new CancellationTokenSource();
    cts.cancel();

    const result = await svc.getConnectedColumns(
      {
        targets: [["model.src", "id"]],
        upstreamExpansion: false,
        currAnd1HopTables: ["model.src", "model.parent"],
        selectedColumn: { name: "id", table: "model.src" },
        showIndirectEdges: false,
      },
      cts,
    );

    expect(result).toBeUndefined();
    expect(fakeCompute).not.toHaveBeenCalled();
    expect(errorMessages).toHaveLength(0);
  });
});
