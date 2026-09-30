import fc from "fast-check";
import { readFileSync } from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import {
  columnEdges,
  columnLineageArgs,
  toPanelLineage,
} from "../../core/lineage";
import { NUM_RUNS } from "../arbitraries";
import { listNodesResult } from "../arbitraries/columnLineage";
import { esmDirname } from "../esmDirname";

const FUSION_2_0_6_TOTAL = JSON.parse(
  readFileSync(
    path.join(
      esmDirname(import.meta.url),
      "fixtures",
      "fusion-lsp-2.0.6",
      "listnodes-order-totals-total.json",
    ),
    "utf8",
  ),
);

const id = ({ uniqueId, column }: { uniqueId: string; column: string }) =>
  `${uniqueId}.${column}`;

describe("columnLineageArgs", () => {
  it("sends the node and the column's lineage filter", () => {
    expect(columnLineageArgs("model.p.a", "x")).toEqual([
      "@model.p.a",
      "+column:model.p.a.x+",
    ]);
  });
});

describe("columnEdges on captured Fusion 2.0.6 output", () => {
  it("maps each parent to an edge with the node's op", () => {
    expect(toPanelLineage(columnEdges(FUSION_2_0_6_TOTAL))).toEqual([
      {
        source: ["model.lineage_probe.stg_orders", "amount"],
        target: ["model.lineage_probe.order_totals", "total"],
        type: "direct",
        viewsType: "Transformation",
      },
      {
        source: ["source.lineage_probe.raw.orders", "amount"],
        target: ["model.lineage_probe.stg_orders", "amount"],
        type: "direct",
        viewsType: "Unchanged",
      },
      {
        source: ["model.lineage_probe.order_totals", "total"],
        target: ["model.lineage_probe.totals_downstream", "grand_total"],
        type: "direct",
        viewsType: "Alias",
      },
      {
        source: ["model.lineage_probe.order_totals", "total"],
        target: ["model.lineage_probe.totals_star", "total"],
        type: "direct",
        viewsType: "Unchanged",
      },
    ]);
  });

  it("maps scan to an indirect edge", () => {
    const edges = columnEdges({
      nodes: [
        {
          unique_id: "model.p.b.n",
          name: "n",
          op: "scan",
          parents: ["model.p.a.x"],
        },
      ],
    });
    expect(toPanelLineage(edges)).toEqual([
      {
        source: ["model.p.a", "x"],
        target: ["model.p.b", "n"],
        type: "indirect",
        viewsType: "Non select",
      },
    ]);
  });

  it("maps an unknown op to Not sure", () => {
    const edges = columnEdges({
      nodes: [
        {
          unique_id: "model.p.b.n",
          name: "n",
          op: "unknown",
          parents: ["model.p.a.x"],
        },
      ],
    });
    expect(toPanelLineage(edges)).toEqual([
      {
        source: ["model.p.a", "x"],
        target: ["model.p.b", "n"],
        type: "direct",
        viewsType: "Not sure",
      },
    ]);
  });

  it("splits a column name containing a dot by the node's name", () => {
    const edges = columnEdges({
      nodes: [
        {
          unique_id: "model.p.b.a.b",
          name: "a.b",
          op: "copy",
          parents: ["model.p.a.a.b"],
        },
        { unique_id: "model.p.a.a.b", name: "a.b", op: "copy", parents: [] },
      ],
    });
    expect(edges).toEqual([
      {
        parent: { uniqueId: "model.p.a", column: "a.b" },
        child: { uniqueId: "model.p.b", column: "a.b" },
        evolution: "copy",
      },
    ]);
  });

  it("skips nodes of unknown shape", () => {
    expect(
      columnEdges({
        nodes: [
          null,
          "x",
          { unique_id: "model.p.b.n", parents: ["model.p.a.x"] },
          { unique_id: "model.p.b.n", name: "other", parents: ["model.p.a.x"] },
        ],
      }),
    ).toEqual([]);
    expect(columnEdges({})).toEqual([]);
  });
});

describe("columnEdges properties", () => {
  it("every edge's endpoints are a node or a node's parent", () => {
    fc.assert(
      fc.property(listNodesResult, (result) => {
        const nodes = new Set(result.nodes.map((node) => node.unique_id));
        const parents = new Set(result.nodes.flatMap((node) => node.parents));
        for (const edge of columnEdges(result)) {
          expect(nodes.has(id(edge.child))).toBe(true);
          expect(parents.has(id(edge.parent))).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("invents no edge: each is a listed node-parent pair", () => {
    fc.assert(
      fc.property(listNodesResult, (result) => {
        const pairs = new Set(
          result.nodes.flatMap((node) =>
            node.parents.map((parent) => `${parent}\u0000${node.unique_id}`),
          ),
        );
        const edges = columnEdges(result);
        for (const edge of edges) {
          expect(pairs.has(`${id(edge.parent)}\u0000${id(edge.child)}`)).toBe(
            true,
          );
        }
        expect(edges.length).toBeLessThanOrEqual(pairs.size);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("is unchanged by repeating nodes", () => {
    fc.assert(
      fc.property(listNodesResult, (result) => {
        const doubled = {
          ...result,
          nodes: [...result.nodes, ...result.nodes],
        };
        expect(columnEdges(doubled)).toEqual(columnEdges(result));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
