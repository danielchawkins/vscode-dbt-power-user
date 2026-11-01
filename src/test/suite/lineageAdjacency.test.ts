import { describe, expect, it } from "vitest";
import { LineageAdjacency } from "../../features/lineage/lineageAdjacency";
import { LineageService } from "../../features/lineage/lineageService";

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
  if (excluded) {
    (svc as any).adjacencyOf = () =>
      new LineageAdjacency(graphMetaMap, excluded);
  }
  return svc;
}

const byPair = (a: [string, string], b: [string, string]) =>
  a.join().localeCompare(b.join());

/** The pairs the neighbourhood requests draw among `tables`: each table's children and parents that are in `tables`. */
function neighbourhoodPairs(
  svc: LineageService,
  tables: string[],
): [string, string][] {
  const inSet = new Set(tables);
  const pairs: [string, string][] = [];
  for (const table of tables) {
    for (const child of svc.getChildTables({ table }).tables ?? []) {
      if (inSet.has(child.table)) {
        pairs.push([table, child.table]);
      }
    }
    for (const parent of svc.getParentTables({ table }).tables ?? []) {
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
  it("give the same data-flow edges for the same tables", () => {
    const svc = makeService(sampleGraph());
    const tables = ["a", "b", "c", "d", "e"];

    const whole = svc
      .getProjectGraph()
      .edges.filter(([p, c]) => tables.includes(p) && tables.includes(c))
      .toSorted(byPair);
    const hood = neighbourhoodPairs(svc, tables);

    expect(whole).toEqual(hood);
    expect(svc.getTableEdges({ tables }).edges.toSorted(byPair)).toEqual(hood);
    expect(hood).toEqual([
      ["a", "b"],
      ["a", "e"],
      ["b", "c"],
      ["e", "c"],
    ]);
  });

  it("agree on a subset of the tables, and with an excluded node taking its edges from every request", () => {
    const tables = ["a", "b", "c"];
    const excluded = new Set(["b"]);
    const svc = makeService(sampleGraph(), excluded);

    const whole = svc
      .getProjectGraph()
      .edges.filter(([p, c]) => tables.includes(p) && tables.includes(c))
      .toSorted(byPair);

    expect(whole).toEqual([]);
    expect(svc.getTableEdges({ tables }).edges).toEqual([]);
    expect(neighbourhoodPairs(svc, tables)).toEqual([]);
    expect(svc.getProjectGraph().tables.map((t) => t.table)).not.toContain("b");
    expect(svc.getChildTables({ table: "b" }).tables).toBeUndefined();
  });
});
