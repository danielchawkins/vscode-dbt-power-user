import type { lineage } from "@fusion-power-user/webview-contract";
import { describe, expect, it } from "vitest";
import { collapsedGroups } from "./expansionGroups";
import { filteredOutTables } from "./filteredOut";
import type { GraphState, GraphStore } from "./graph";
import {
  addNeighbours,
  drawnIds,
  emptyGraph,
  expand,
  knownPairs,
  linkDrawn,
} from "./graph";
import { combinedEdges } from "./groupEdges";
import { groupNodeId } from "./grouping";

const table = (id: string, filteredOut = false): lineage.LineageTable => ({
  table: id,
  label: id,
  nodeType: "model",
  childCount: 0,
  parentCount: 0,
  tests: [],
  hidden: filteredOut,
});

const GA = groupNodeId("c:hub", "models/a");
const GP = groupNodeId("p:hub", "pkg:macros");

/**
 * `hub` drawn, with children x, y1 (bucket `models/a`), y2 (loose) and parents u1, u2 (bucket `pkg:macros`). Only y2
 * is drawn besides the hub; `filteredOut` lists tables to mark filtered out.
 */
const scene = ({
  filteredOut = [],
  ...overrides
}: Partial<GraphState> & { filteredOut?: string[] } = {}): GraphState => ({
  ...emptyGraph(table("hub")),
  known: Object.fromEntries(
    ["hub", "x", "y1", "y2", "u1", "u2", "q", "r"].map((id) => [
      id,
      table(id, filteredOut.includes(id)),
    ]),
  ),
  expansions: ["c:hub", "p:hub"],
  neighbours: { "c:hub": ["x", "y1", "y2"], "p:hub": ["u1", "u2"] },
  groups: {
    "c:hub": {
      buckets: [{ key: "models/a", members: ["x", "y1"] }],
      loose: ["y2"],
      open: {},
    },
    "p:hub": {
      buckets: [{ key: "pkg:macros", members: ["u1", "u2"] }],
      loose: [],
      open: {},
    },
  },
  ...overrides,
});

const edgesOf = (state: GraphState) =>
  combinedEdges(state, collapsedGroups(state));

const linkOf = (parent: string, child: string) => ({
  [`${parent}\u0000${child}`]: [parent, child] as [string, string],
});

describe("combinedEdges", () => {
  it("draws the hub edge of each group, to a child group and from a parent group", () => {
    expect(edgesOf(scene())).toEqual([
      ["hub", GA],
      [GP, "hub"],
    ]);
  });

  it("draws an edge from a drawn card to a group that a link reaches", () => {
    const state = scene({ links: linkOf("y2", "x") });
    expect(edgesOf(state)).toContainEqual(["y2", GA]);
  });

  it("draws an edge from one group to another that a link joins", () => {
    const state = scene({ links: linkOf("x", "u1") });
    expect(edgesOf(state)).toContainEqual([GA, GP]);
  });

  it("draws no edge for a filtered-out member, though the group's other members still draw theirs", () => {
    const filtered = scene({ filteredOut: ["x"], links: linkOf("y2", "x") });
    const edges = edgesOf(filtered);
    expect(edges).not.toContainEqual(["y2", GA]);
    expect(edges.flat()).not.toContain("x");
    expect(edges).toContainEqual(["hub", GA]);

    const visible = scene({ links: linkOf("y2", "y1") });
    expect(edgesOf(visible)).toContainEqual(["y2", GA]);
  });

  it("draws no edge for a group whose table is filtered out", () => {
    const state = scene({
      filteredOut: ["y2"],
      expansions: ["c:hub", "p:hub", "c:y2"],
      neighbours: {
        "c:hub": ["x", "y1", "y2"],
        "p:hub": ["u1", "u2"],
        "c:y2": ["q", "r"],
      },
      groups: {
        "c:hub": {
          buckets: [{ key: "models/a", members: ["x", "y1"] }],
          loose: ["y2"],
          open: {},
        },
        "p:hub": {
          buckets: [{ key: "pkg:macros", members: ["u1", "u2"] }],
          loose: [],
          open: {},
        },
        "c:y2": {
          buckets: [{ key: "models/q", members: ["q", "r"] }],
          loose: [],
          open: {},
        },
      },
      links: linkOf("q", "u1"),
    });
    const filteredOutGroup = groupNodeId("c:y2", "models/q");
    expect(filteredOutTables(state).has("y2")).toBe(true);
    expect(edgesOf(state).flat()).not.toContain(filteredOutGroup);
  });

  it("draws no edge for a member that is drawn elsewhere, since its pairs are table edges", () => {
    const state = scene({
      expansions: ["c:hub", "p:hub", "c:y2"],
      neighbours: {
        "c:hub": ["x", "y1", "y2"],
        "p:hub": ["u1", "u2"],
        "c:y2": ["x"],
      },
      links: { ...linkOf("x", "y2"), ...linkOf("x", "r") },
    });
    // `x` is drawn as a child of `y2`, so the pairs through it are between drawn cards or reach nothing drawn.
    expect(drawnIds(state).has("x")).toBe(true);
    expect(edgesOf(state)).toEqual([
      ["hub", GA],
      [GP, "hub"],
    ]);
  });

  it("draws no edge to a pair whose other end is not drawn", () => {
    const state = scene({
      links: { ...linkOf("y2", "r"), ...linkOf("q", "u1") },
    });
    expect(edgesOf(state)).toEqual([
      ["hub", GA],
      [GP, "hub"],
    ]);
  });

  it("draws no group edge for a group that has no visible member", () => {
    const state = scene({ filteredOut: ["x", "y1"] });
    expect(edgesOf(state).flat()).not.toContain(GA);
  });

  it("gives every edge a group end, and matches each edge to a link or neighbour pair (random DAGs)", async () => {
    let total = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const dag = randomDag(seed);
      const store = storeOf(emptyGraph(dag.tables[0], 2, "folder"));
      const picks = prng(seed * 7919);
      for (let step = 0; step < 6; step += 1) {
        const drawn = [...drawnIds(store.get())].toSorted();
        const pick = drawn[Math.floor(picks() * drawn.length)] ?? dag.start;
        const direction = picks() < 0.5 ? "children" : "parents";
        await expand(store, direction, pick, dag.fetchNeighbours);
        await linkDrawn(store, dag.fetchEdges);
      }
      const state = store.get();
      const groups = collapsedGroups(state);
      const edges = combinedEdges(state, groups);
      const pairs = knownPairs(state);
      const drawn = drawnIds(state);
      const filteredOut = filteredOutTables(state);
      total += edges.length;
      for (const [from, to] of edges) {
        expect(from).not.toBe(to);
        expect(drawn.has(from) && drawn.has(to)).toBe(false);
        expect(filteredOut.has(from) || filteredOut.has(to)).toBe(false);
        expect(
          pairs.some(
            ([p, c]) => reaches(state, from, p) && reaches(state, to, c),
          ),
        ).toBe(true);
      }
    }
    expect(total).toBeGreaterThan(0);
  });

  it("draws a finance-shaped hub's folders as groups joined to each other, to a parent, and to hub", () => {
    const hub = table("fct_finance");
    const child = (folder: string, id: string, filteredOut = false) => ({
      ...table(id, filteredOut),
      path: `${folder}/${id}.sql`,
      rootPackage: true,
    });
    const ledger = ["l1", "l2", "l3", "l4", "l5"].map((id) =>
      child("models/finance/ledger", id),
    );
    const payments = ["p1", "p2", "p3", "p4"].map((id) =>
      child("models/finance/payments", id, id === "p4"),
    );
    const marts = ["m1", "m2", "m3"].map((id) => child("models/marts", id));
    const stg = child("models/staging", "stg_orders");
    let state = addNeighbours(
      emptyGraph(hub, 4, "folder"),
      "parents",
      "fct_finance",
      [stg],
    );
    state = addNeighbours(state, "children", "fct_finance", [
      ...ledger,
      ...payments,
      ...marts,
    ]);
    const ledgerGroup = groupNodeId("c:fct_finance", "models/finance/ledger");
    const paymentsGroup = groupNodeId(
      "c:fct_finance",
      "models/finance/payments",
    );
    const martsGroup = groupNodeId("c:fct_finance", "models/marts");
    state = {
      ...state,
      links: {
        ...linkOf("l1", "p1"),
        ...linkOf("l2", "m1"),
        ...linkOf("stg_orders", "l3"),
        ...linkOf("stg_orders", "p4"),
      },
    };
    expect(collapsedGroups(state).map((g) => g.id)).toEqual([
      ledgerGroup,
      paymentsGroup,
      martsGroup,
    ]);
    const edges = edgesOf(state);
    expect(edges).toHaveLength(6);
    expect(edges).toEqual(
      expect.arrayContaining([
        ["fct_finance", ledgerGroup],
        ["fct_finance", paymentsGroup],
        ["fct_finance", martsGroup],
        [ledgerGroup, paymentsGroup],
        [ledgerGroup, martsGroup],
        ["stg_orders", ledgerGroup],
      ]),
    );
  });
});

/** Whether `end` (a drawn table or a group) stands for `id`: the table itself, or a group that holds it. */
const reaches = (state: GraphState, end: string, id: string): boolean =>
  end === id ||
  state.expansions.some((key) =>
    (state.groups[key]?.buckets ?? []).some(
      (bucket) =>
        groupNodeId(key, bucket.key) === end && bucket.members.includes(id),
    ),
  );

const storeOf = (state: GraphState): GraphStore => {
  let current = state;
  return {
    get: () => current,
    update: (change) => {
      current = change(current);
    },
  };
};

/** A small seeded PRNG (mulberry32), so each seed draws the same graph and steps every run. */
function prng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random DAG of eight tables numbered in order, so every edge runs from a lower to a higher number. */
function randomDag(seed: number) {
  const next = prng(seed);
  const names = Array.from({ length: 8 }, (_, i) => `t${i}`);
  const folders = ["models/a", "models/b", "models/c"];
  const filteredOutFlags = names.map((_, i) => i > 0 && next() < 0.15);
  const folderOf = names.map(
    () => folders[Math.floor(next() * folders.length)],
  );
  const pairs: [string, string][] = [];
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      if (next() < 0.35) {
        pairs.push([names[i], names[j]]);
      }
    }
  }
  // Counts come from the pairs, so a table with neighbours offers an expansion.
  const tables = names.map((id, i) => ({
    ...table(id, filteredOutFlags[i]),
    childCount: pairs.filter(([p]) => p === id).length,
    parentCount: pairs.filter(([, c]) => c === id).length,
    path: `${folderOf[i]}/${id}.sql`,
    rootPackage: true,
  }));
  const byId = new Map(tables.map((t) => [t.table, t]));
  const fetchNeighbours = async (
    direction: "children" | "parents",
    id: string,
  ) =>
    pairs
      .filter(([p, c]) => (direction === "children" ? p === id : c === id))
      .map(([p, c]) => byId.get(direction === "children" ? c : p))
      .filter((t) => t !== undefined);
  const fetchEdges = async (ids: readonly string[]) =>
    pairs.filter(([p, c]) => ids.includes(p) && ids.includes(c));
  return { tables, start: names[0], fetchNeighbours, fetchEdges };
}
