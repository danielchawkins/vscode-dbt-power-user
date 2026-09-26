import { describe, expect, it, jest } from "@jest/globals";
import { DbtLineageService } from "../../services/dbtLineageService";

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

describe("DbtLineageService.getConnectedColumns", () => {
  const edge = (parent: string, child: string) => {
    const [parentId, parentColumn] = parent.split(":");
    const [childId, childColumn] = child.split(":");
    return {
      parent: { uniqueId: parentId, column: parentColumn },
      child: { uniqueId: childId, column: childColumn },
      evolution: "copy" as const,
    };
  };

  function withProject(readColumnLineage: jest.Mock | undefined) {
    const svc = Object.create(DbtLineageService.prototype) as DbtLineageService;
    (svc as any).queryManifestService = {
      getProject: () => (readColumnLineage ? { readColumnLineage } : undefined),
    };
    return svc;
  }

  it("reads upstream edges for the target tables and keeps the requested child columns", async () => {
    const read = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({
      kind: "edges",
      edges: [
        edge("model.p.a:x", "model.p.b:total"),
        edge("model.p.a:y", "model.p.b:n"),
      ],
    });
    const result = await withProject(read).getConnectedColumns({
      targets: [["model.p.b", "TOTAL"]],
      upstreamExpansion: true,
    });

    expect(read).toHaveBeenCalledWith(["model.p.b"], "upstream", undefined);
    expect(result).toEqual({
      kind: "lineage",
      columnLineage: [
        {
          source: ["model.p.a", "x"],
          target: ["model.p.b", "total"],
          type: "direct",
          viewsType: "Alias",
        },
      ],
    });
  });

  it("reads downstream edges and keeps the requested parent columns", async () => {
    const read = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({
      kind: "edges",
      edges: [
        edge("model.p.a:x", "model.p.b:x"),
        edge("model.p.a:y", "model.p.b:y"),
      ],
    });
    const result = await withProject(read).getConnectedColumns({
      targets: [
        ["model.p.a", "x"],
        ["model.p.a", "y"],
      ],
      upstreamExpansion: false,
    });

    expect(read).toHaveBeenCalledWith(["model.p.a"], "downstream", undefined);
    expect(result.kind === "lineage" && result.columnLineage).toHaveLength(2);
  });

  it("passes a non-edge read through", async () => {
    const read = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue({ kind: "unavailable" });
    expect(
      await withProject(read).getConnectedColumns({
        targets: [["model.p.a", "x"]],
        upstreamExpansion: true,
      }),
    ).toEqual({ kind: "noLineage", read: { kind: "unavailable" } });
  });

  it("answers empty without a current project", async () => {
    expect(
      await withProject(undefined).getConnectedColumns({
        targets: [["model.p.a", "x"]],
        upstreamExpansion: true,
      }),
    ).toEqual({ kind: "noLineage", read: { kind: "empty" } });
  });
});
