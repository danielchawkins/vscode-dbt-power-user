import { describe, expect, it, type Mock, vi } from "vitest";
import { workspace } from "vscode";
import {
  DbtLineageService,
  describeNoLineage,
} from "../../features/lineage/dbtLineageService";

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
  it("getChildTables hides constraint edges and keeps data edges", () => {
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
      .getChildTables({ table: "model.p.fact" })
      .tables!.map((t) => t.table);
    expect(tables).toContain("model.p.int");
    expect(tables).not.toContain("model.p.dim");
  });

  it("getParentTables hides constraint edges", () => {
    const parents = new Map([
      ["model.p.dim", { nodes: [node("model.p.fact", "constraint")] }],
      ["model.p.int", { nodes: [node("model.p.fact", "data")] }],
    ]);
    const svc = makeService({ parents, children: new Map() });

    // fact is only a constraint-parent of dim → dim has no data-flow parents
    expect(svc.getParentTables({ table: "model.p.dim" }).tables).toEqual([]);
    // but it's a real parent of int
    expect(
      svc.getParentTables({ table: "model.p.int" }).tables!.map((t) => t.table),
    ).toEqual(["model.p.fact"]);
  });

  it("treats untagged edges (no edgeType) as data-flow", () => {
    const children = new Map([
      ["model.p.fact", { nodes: [node("model.p.int")] }],
    ]);
    const svc = makeService({ children, parents: new Map() });
    expect(
      svc.getChildTables({ table: "model.p.fact" }).tables!.map((t) => t.table),
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

describe("DbtLineageService.getConnectedColumns", () => {
  const listNodes = (...nodes: [string, string[], string?][]) => ({
    error: null,
    nodes: nodes.map(([uniqueId, parents, op = "copy"]) => ({
      unique_id: uniqueId,
      name: uniqueId.slice(uniqueId.lastIndexOf(".") + 1),
      parents,
      op,
    })),
  });

  function fakeClient(
    request: Mock<(...args: any[]) => Promise<any>>,
    overrides: Partial<{
      state: string;
      staticAnalysis: string;
      failureReason: string;
    }> = {},
  ) {
    return {
      state: "running",
      staticAnalysis: "strict",
      failureReason: undefined,
      request,
      ...overrides,
    } as any;
  }

  const service = (client: unknown) =>
    new DbtLineageService({} as any, () => client as any);

  const lineage = listNodes(
    ["model.p.b.total", ["model.p.a.x"], "mod"],
    ["model.p.a.x", ["source.p.raw.t.x"]],
    ["model.p.c.total", ["model.p.b.total"]],
  );

  it("asks listNodes for each target column and keeps its parents when expanding left", async () => {
    const request = vi
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue(lineage);
    const result = await service(fakeClient(request)).getConnectedColumns({
      targets: [["model.p.b", "total"]],
      upstreamExpansion: false,
    });

    expect(request).toHaveBeenCalledWith("dbt.listNodes", [
      "@model.p.b",
      "+column:model.p.b.total+",
    ]);
    expect(result).toEqual({
      kind: "lineage",
      columnLineage: [
        {
          source: ["model.p.a", "x"],
          target: ["model.p.b", "total"],
          type: "direct",
          viewsType: "Transformation",
        },
      ],
    });
  });

  it("keeps the target's children when expanding right, one request per distinct column, spelled as requested", async () => {
    const request = vi
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue(lineage);
    const result = await service(fakeClient(request)).getConnectedColumns({
      targets: [
        ["model.p.b", "TOTAL"],
        ["model.p.b", "total"],
      ],
      upstreamExpansion: true,
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      kind: "lineage",
      columnLineage: [
        {
          source: ["model.p.b", "TOTAL"],
          target: ["model.p.c", "total"],
          type: "direct",
          viewsType: "Unchanged",
        },
      ],
    });
  });

  it("keeps the lineage that answered and reports the target that failed", async () => {
    const request = vi
      .fn<(...args: any[]) => Promise<any>>()
      .mockImplementation(async (_command: string, args: string[]) => {
        if (args[0] === "@model.p.x") {
          throw new Error("timeout");
        }
        return lineage;
      });
    const result = await service(fakeClient(request)).getConnectedColumns({
      targets: [
        ["model.p.b", "total"],
        ["model.p.x", "y"],
      ],
      upstreamExpansion: true,
    });

    expect(result).toEqual({
      kind: "lineage",
      columnLineage: [
        expect.objectContaining({ target: ["model.p.c", "total"] }),
      ],
      failures: [{ target: ["model.p.x", "y"], message: "timeout" }],
    });
  });

  it.each([
    [
      "a RequestCancelled code",
      Object.assign(new Error("x"), { code: -32800 }),
    ],
    ["an Operation cancelled message", new Error("Operation cancelled")],
  ])("retries a request cancelled with %s once", async (_name, cancelled) => {
    const request = vi
      .fn<(...args: any[]) => Promise<any>>()
      .mockRejectedValueOnce(cancelled)
      .mockResolvedValueOnce(lineage);
    const result = await service(fakeClient(request)).getConnectedColumns({
      targets: [["model.p.b", "total"]],
      upstreamExpansion: true,
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(result.kind).toBe("lineage");
  });

  it("reports a request cancelled twice as failed", async () => {
    const request = vi
      .fn<(...args: any[]) => Promise<any>>()
      .mockRejectedValue(new Error("Operation cancelled"));
    const result = await service(fakeClient(request)).getConnectedColumns({
      targets: [["model.p.b", "total"]],
      upstreamExpansion: true,
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      kind: "noLineage",
      reason: { kind: "failed", message: "Operation cancelled" },
    });
  });

  it("does not retry other failures", async () => {
    const request = vi
      .fn<(...args: any[]) => Promise<any>>()
      .mockRejectedValue(new Error("timeout"));
    await service(fakeClient(request)).getConnectedColumns({
      targets: [["model.p.b", "total"]],
      upstreamExpansion: true,
    });

    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    [undefined, "stopped"],
    [fakeClient(vi.fn(), { state: "starting" }), "starting"],
  ])(
    "reports the client's state when it is not running",
    async (client, state) => {
      const result = await service(client).getConnectedColumns({
        targets: [["model.p.a", "x"]],
        upstreamExpansion: true,
      });
      expect(result).toEqual({
        kind: "noLineage",
        reason: { kind: "notRunning", state, failure: undefined },
      });
    },
  );

  it("names the failure of a failed client", async () => {
    const result = await service(
      fakeClient(vi.fn(), { state: "failed", failureReason: "boom\nmore" }),
    ).getConnectedColumns({
      targets: [["model.p.a", "x"]],
      upstreamExpansion: true,
    });
    expect(result).toEqual({
      kind: "noLineage",
      reason: { kind: "notRunning", state: "failed", failure: "boom" },
    });
  });

  it.each(["baseline", "off"])(
    "names the static-analysis mode when %s returns no nodes",
    async (mode) => {
      const request = vi
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue({ error: null, nodes: [] });
      const result = await service(
        fakeClient(request, { staticAnalysis: mode }),
      ).getConnectedColumns({
        targets: [["model.p.a", "x"]],
        upstreamExpansion: true,
      });
      expect(result).toEqual({
        kind: "noLineage",
        reason: { kind: "staticAnalysis", mode },
      });
      expect(describeNoLineage((result as any).reason)).toContain(
        "fusionPowerUser.staticAnalysis",
      );
    },
  );

  it("answers empty for no nodes under strict or project", async () => {
    const request = vi
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue({ error: null, nodes: [] });
    const result = await service(
      fakeClient(request, { staticAnalysis: "project" }),
    ).getConnectedColumns({
      targets: [["model.p.a", "x"]],
      upstreamExpansion: true,
    });
    expect(result).toEqual({ kind: "noLineage", reason: { kind: "empty" } });
    const message = describeNoLineage({ kind: "empty" });
    expect(message).toContain("no recorded column lineage");
    expect(message).not.toContain("strict");
  });

  it("passes the result's error field through", async () => {
    const request = vi
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue({ error: "no such node", nodes: [] });
    const result = await service(fakeClient(request)).getConnectedColumns({
      targets: [["model.p.a", "x"]],
      upstreamExpansion: true,
    });
    expect(result).toEqual({
      kind: "noLineage",
      reason: { kind: "failed", message: "no such node" },
    });
  });

  it("reports a rejected request as failed", async () => {
    const request = vi
      .fn<(...args: any[]) => Promise<any>>()
      .mockRejectedValue(new Error("timeout"));
    const result = await service(fakeClient(request)).getConnectedColumns({
      targets: [["model.p.a", "x"]],
      upstreamExpansion: true,
    });
    expect(result).toEqual({
      kind: "noLineage",
      reason: { kind: "failed", message: "timeout" },
    });
  });
});

describe("DbtLineageService.getInferredColumns", () => {
  const node = {
    node: { columns: { customer_id: { data_type: "integer" } } },
  };
  const client = (request: Mock<(...args: any[]) => Promise<any>>) =>
    new DbtLineageService(
      {} as any,
      () => ({ state: "running", request }) as any,
    );

  it("asks getCurrentNode with the project-relative path", async () => {
    const request = vi
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue(node);
    const columns = await client(request).getInferredColumns(
      "/p",
      "/p/models/a.sql",
    );
    expect(request).toHaveBeenCalledWith("dbt.getCurrentNode", [
      "models/a.sql",
    ]);
    expect(columns).toEqual([{ name: "customer_id", datatype: "integer" }]);
  });

  it("opens the document and asks once more after a null answer", async () => {
    const request = vi
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(node);
    const columns = await client(request).getInferredColumns(
      "/p",
      "/p/models/a.sql",
    );
    expect(workspace.openTextDocument).toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(2);
    expect(columns).toHaveLength(1);
  });

  it("is undefined when the client is not running or the request fails", async () => {
    expect(
      await new DbtLineageService(
        {} as any,
        () => undefined,
      ).getInferredColumns("/p", "/p/a.sql"),
    ).toBeUndefined();
    const request = vi
      .fn<(...args: any[]) => Promise<any>>()
      .mockRejectedValue(new Error("boom"));
    expect(
      await client(request).getInferredColumns("/p", "/p/a.sql"),
    ).toBeUndefined();
  });
});

describe("DbtLineageService — merged value", () => {
  it("draws a server node the parse lacks with no tests", () => {
    const svc = new DbtLineageService({} as any);
    const added = {
      unique_id: "model.p.new",
      alias: "new",
      path: "/p/models/new.sql",
      description: "",
      columns: {},
      config: { materialized: "view" },
      package_name: "p",
      patch_path: "",
      meta: {},
    };
    const event: any = {
      graphMetaMap: {
        parents: new Map(),
        children: new Map(),
        tests: new Map(),
        metrics: new Map(),
      },
      testMetaMap: new Map(),
      nodeMetaMap: {
        lookupByUniqueId: (id: string) =>
          id === added.unique_id ? added : undefined,
      },
    };
    expect(
      svc.createTable(event, "/p/models/new.sql", "model.p.new"),
    ).toMatchObject({
      table: "model.p.new",
      label: "new",
      materialization: "view",
      tests: [],
    });
  });
});
