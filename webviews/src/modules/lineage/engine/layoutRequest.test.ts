import type { lineage } from "@fusion-power-user/webview-contract";
import { describe, expect, it } from "vitest";
import type { LayoutInput } from "./layoutRequest";
import { layoutRequest } from "./layoutRequest";

const table = (id: string): lineage.LineageTable => ({
  table: id,
  label: id,
  nodeType: "model",
  parentCount: 0,
  childCount: 0,
  tests: [],
});

/** A chain `a` feeds `b`, which feeds `c`; `a` also feeds `d`. Each table is drawn. */
const input = (softened?: string[]): LayoutInput => ({
  data: {
    start: "b",
    tables: ["a", "b", "c", "d"].map(table),
    edges: [
      ["a", "b"],
      ["b", "c"],
      ["a", "d"],
    ],
    columnEdges: [],
  },
  columns: {},
  columnTables: [],
  refs: [],
  ...(softened ? { softened } : {}),
});

const request = (softened?: string[]) =>
  layoutRequest(
    input(softened),
    () => undefined,
    () => 40,
  );

describe("layoutRequest with softened cards", () => {
  it("draws every dependency as a table edge, and ranks each pair, when no card is softened", () => {
    const { edges, rankPairs } = request();
    expect(edges.map((edge) => edge.role)).toEqual(["table", "table", "table"]);
    expect(rankPairs).toEqual([
      ["a", "b"],
      ["b", "c"],
      ["a", "d"],
    ]);
  });

  it("makes each dependency of a softened card a soft edge, and ranks nothing through it", () => {
    const { edges, rankPairs } = request(["b"]);
    expect(edges.map((edge) => [edge.from, edge.to, edge.role])).toEqual([
      ["a", "b", "soft"],
      ["b", "c", "soft"],
      ["a", "d", "table"],
    ]);
    expect(rankPairs).toEqual([["a", "d"]]);
  });

  it("keeps the soft edge's id, so the drawn edge finds its path", () => {
    const plain = request().edges.map((edge) => edge.id);
    const soft = request(["c"]).edges.map((edge) => edge.id);
    expect(soft).toEqual(plain);
  });
});
