import { afterEach, describe, expect, it, vi } from "vitest";
import { workspace } from "vscode";
import { LineageAdjacency } from "../../features/lineage/lineageAdjacency";
import { LineageExclusions } from "../../features/lineage/lineageExclusion";
import { LineageService } from "../../features/lineage/lineageService";
import { silentLog } from "../testLog";
import { unavailableExclusions } from "../unavailableExclusions";

// Minimal NodeData-shaped edge.
function node(key: string, edgeType?: "data" | "constraint") {
  return { label: key, key, resourceType: "model", edgeType };
}

// The graph a -> b, a -> e, b -> c, e -> c (data), a -> d (foreign key only), with parents kept in step.
function sampleGraph() {
  const children = new Map([
    [
      "a",
      {
        nodes: [node("b", "data"), node("d", "constraint"), node("e", "data")],
      },
    ],
    ["b", { nodes: [node("c", "data")] }],
    ["e", { nodes: [node("c", "data")] }],
  ]);
  const parents = new Map([
    ["b", { nodes: [node("a", "data")] }],
    ["d", { nodes: [node("a", "constraint")] }],
    ["e", { nodes: [node("a", "data")] }],
    ["c", { nodes: [node("b", "data"), node("e", "data")] }],
  ]);
  return { parents, children, tests: new Map(), metrics: new Map() };
}

// Builds a LineageService with the DI bypassed; createTable is stubbed to a minimal { table: key }, and
// `adjacency` (when given) replaces the host adjacency the requests read.
function makeService(graphMetaMap: any, excluded?: ReadonlySet<string>) {
  const svc = Object.create(LineageService.prototype) as LineageService;
  (svc as any).currentProject = {
    current: { manifest: { graphMetaMap } },
  };
  (svc as any).createTable = (
    _e: unknown,
    _url: string | undefined,
    key: string,
  ) => ({ table: key });
  (svc as any).tableOf = ({ key }: { key: string }) => ({ table: key });
  (svc as any).exclusions = unavailableExclusions();
  if (excluded) {
    (svc as any).adjacencyOf = async () =>
      new LineageAdjacency(graphMetaMap, excluded);
  }
  return svc;
}

const byPair = (a: [string, string], b: [string, string]) =>
  a.join().localeCompare(b.join());

/** The pairs the neighbourhood requests draw among `tables`: each table's children and parents that are in `tables`. */
async function neighbourhoodPairs(
  svc: LineageService,
  tables: string[],
): Promise<[string, string][]> {
  const inSet = new Set(tables);
  const pairs: [string, string][] = [];
  for (const table of tables) {
    for (const child of (await svc.getChildTables({ table })).tables ?? []) {
      if (inSet.has(child.table)) {
        pairs.push([table, child.table]);
      }
    }
    for (const parent of (await svc.getParentTables({ table })).tables ?? []) {
      if (inSet.has(parent.table)) {
        pairs.push([parent.table, table]);
      }
    }
  }
  // A pair found from both ends is one edge.
  return [...new Map(pairs.map((p) => [p.join(), p])).values()].sort(byPair);
}

describe("LineageAdjacency", () => {
  it("keeps data-flow neighbours in both directions and leaves out foreign-key-only edges", () => {
    const adjacency = new LineageAdjacency(sampleGraph() as any);

    expect(adjacency.neighbours("children", "a").map((n) => n.key)).toEqual([
      "b",
      "e",
    ]);
    expect(adjacency.neighbours("parents", "d")).toEqual([]);
    expect(adjacency.count("parents", "c")).toBe(2);
  });

  it("drops an excluded node with its edges, and does not link its parents to its children", () => {
    // a -> x -> b: excluding x leaves a and b unlinked, not a -> b.
    const graph = {
      children: new Map([
        ["a", { nodes: [node("x", "data")] }],
        ["x", { nodes: [node("b", "data")] }],
      ]),
      parents: new Map([
        ["x", { nodes: [node("a", "data")] }],
        ["b", { nodes: [node("x", "data")] }],
      ]),
    };
    const adjacency = new LineageAdjacency(graph as any, new Set(["x"]));

    expect(adjacency.neighbours("children", "a")).toEqual([]);
    expect(adjacency.neighbours("parents", "b")).toEqual([]);
    expect(adjacency.has("children", "x")).toBe(false);
    expect(adjacency.tableKeys().toSorted()).toEqual(["a", "b"]);
    expect(adjacency.edgesAmong(["a", "b", "x"])).toEqual([]);
  });
});

describe("LineageService: the whole-project and neighbourhood requests agree", () => {
  it("give the same data-flow edges for the same tables", async () => {
    const svc = makeService(sampleGraph());
    const tables = ["a", "b", "c", "d", "e"];

    const whole = (await svc.getProjectGraph()).edges
      .filter(([p, c]) => tables.includes(p) && tables.includes(c))
      .toSorted(byPair);
    const hood = await neighbourhoodPairs(svc, tables);

    expect(whole).toEqual(hood);
    expect(
      (await svc.getTableEdges({ tables })).edges.toSorted(byPair),
    ).toEqual(hood);
    expect(hood).toEqual([
      ["a", "b"],
      ["a", "e"],
      ["b", "c"],
      ["e", "c"],
    ]);
  });

  it("agree on a subset of the tables, and with an excluded node taking its edges from every request", async () => {
    const tables = ["a", "b", "c"];
    const excluded = new Set(["b"]);
    const svc = makeService(sampleGraph(), excluded);

    const whole = (await svc.getProjectGraph()).edges
      .filter(([p, c]) => tables.includes(p) && tables.includes(c))
      .toSorted(byPair);

    expect(whole).toEqual([]);
    expect((await svc.getTableEdges({ tables })).edges).toEqual([]);
    expect(await neighbourhoodPairs(svc, tables)).toEqual([]);
    expect(
      (await svc.getProjectGraph()).tables.map((t) => t.table),
    ).not.toContain("b");
    expect((await svc.getChildTables({ table: "b" })).tables).toBeUndefined();
  });
});

describe("LineageService: exclusion rules from lineage.exclude", () => {
  // a -> x -> b, and a -> c: excluding x must leave a and b unlinked, and keep a -> c.
  const chain = () => ({
    children: new Map([
      ["a", { nodes: [node("x", "data"), node("c", "data")] }],
      ["x", { nodes: [node("b", "data")] }],
    ]),
    parents: new Map([
      ["x", { nodes: [node("a", "data")] }],
      ["c", { nodes: [node("a", "data")] }],
      ["b", { nodes: [node("x", "data")] }],
    ]),
    tests: new Map(),
    metrics: new Map(),
  });

  /** A server that answers each rule from `selects`, and fails the rules `selects` does not name. */
  const serverSelecting = (selects: Record<string, string[]>) => ({
    listNodes: vi.fn(async (selectors: readonly string[]) => {
      const ids = selects[selectors[0] ?? ""];
      if (ids === undefined) {
        throw new Error(`cannot select ${selectors[0]}`);
      }
      return { nodes: ids.map((unique_id) => ({ unique_id })) };
    }),
  });

  function serviceWithRules(
    rules: string[],
    server: ReturnType<typeof serverSelecting>,
  ) {
    vi.mocked(workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string) =>
        key === "lineage.exclude" ? rules : undefined,
      ),
      has: vi.fn(),
      update: vi.fn(),
    } as never);
    const svc = makeService(chain());
    (svc as any).exclusions = new LineageExclusions({
      server: () => server,
      cli: () => {
        throw new Error("no dbt CLI in this test");
      },
      log: silentLog(),
    });
    return svc;
  }

  afterEach(() => {
    vi.mocked(workspace.getConfiguration).mockReturnValue({
      get: vi.fn(),
      has: vi.fn(),
      update: vi.fn(),
    } as never);
  });

  it("links no parent of an excluded node to its children, in either request", async () => {
    const svc = serviceWithRules(
      ["resource_type:function"],
      serverSelecting({ "resource_type:function": ["x"] }),
    );
    const tables = ["a", "b", "c"];

    expect(
      (await svc.getChildTables({ table: "a" })).tables?.map((t) => t.table),
    ).toEqual(["c"]);
    expect((await svc.getParentTables({ table: "b" })).tables).toEqual([]);
    expect(
      (await svc.getProjectGraph()).tables.map((t) => t.table),
    ).not.toContain("x");

    const whole = (await svc.getProjectGraph()).edges.filter(
      ([p, c]) => tables.includes(p) && tables.includes(c),
    );
    expect(whole).toEqual([["a", "c"]]);
    expect((await svc.getTableEdges({ tables })).edges).toEqual([["a", "c"]]);
    expect(await neighbourhoodPairs(svc, tables)).toEqual([["a", "c"]]);
  });

  it("applies the rules that resolve when one rule fails", async () => {
    const svc = serviceWithRules(
      ["resource_type:macro", "resource_type:function"],
      serverSelecting({ "resource_type:function": ["x"] }),
    );

    expect(
      (await svc.getChildTables({ table: "a" })).tables?.map((t) => t.table),
    ).toEqual(["c"]);
    expect(
      (await svc.getProjectGraph()).tables.map((t) => t.table),
    ).not.toContain("x");
    expect(await neighbourhoodPairs(svc, ["a", "b", "c"])).toEqual([
      ["a", "c"],
    ]);
  });
});
