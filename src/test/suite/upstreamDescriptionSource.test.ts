import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { columnLineageArgs } from "../../core/lineage/columnLineage";
import type { NodeMetaMap, SourceMetaMap } from "../../core/manifest/types";
import {
  type EditorColumn,
  resolveUpstreamDescriptions,
} from "../../features/docs/upstreamDescriptionSource";
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

const TOTALS_DOWNSTREAM = "model.lineage_probe.totals_downstream";
const STG_ORDERS = "model.lineage_probe.stg_orders";

/** A fake LSP that answers every `listNodes` with the captured Fusion 2.0.6 result and records the selectors. */
function fakeLsp(state: "running" | "stopped" = "running") {
  const calls: (readonly string[])[] = [];
  return {
    calls,
    lsp: {
      state,
      listNodes: async (selectors: readonly string[]) => {
        calls.push(selectors);
        return FUSION_2_0_6_TOTAL;
      },
    },
  };
}

const ORDER_TOTALS_COLUMNS = {
  total: { description: "Order total" },
};

const manifest = {
  nodeMetaMap: {
    lookupByUniqueId: (id: string) =>
      id === "model.lineage_probe.order_totals"
        ? { columns: ORDER_TOTALS_COLUMNS }
        : undefined,
  } as unknown as NodeMetaMap,
  sourceMetaMap: new Map() as SourceMetaMap,
};

describe("resolveUpstreamDescriptions", () => {
  it("reports notRunning and asks Fusion nothing when the client is stopped", async () => {
    const { lsp, calls } = fakeLsp("stopped");
    const outcome = await resolveUpstreamDescriptions({
      lsp,
      strict: true,
      uniqueId: TOTALS_DOWNSTREAM,
      columns: [{ name: "grand_total", description: "" }],
      manifest,
    });
    expect(outcome).toEqual({ kind: "notRunning", state: "stopped" });
    expect(calls).toEqual([]);
  });

  it("reports needsStrict and asks Fusion nothing when the mode is not strict", async () => {
    const { lsp, calls } = fakeLsp();
    const outcome = await resolveUpstreamDescriptions({
      lsp,
      strict: false,
      uniqueId: TOTALS_DOWNSTREAM,
      columns: [{ name: "grand_total", description: "" }],
      manifest,
    });
    expect(outcome).toEqual({ kind: "needsStrict" });
    expect(calls).toEqual([]);
  });

  it("reports failed with the message and the proposals found so far when a request is rejected, and asks no later column", async () => {
    const calls: (readonly string[])[] = [];
    const failure = new Error("listNodes timed out");
    const lsp = {
      state: "running" as const,
      listNodes: async (selectors: readonly string[]) => {
        calls.push(selectors);
        if (calls.length === 1) {
          return FUSION_2_0_6_TOTAL;
        }
        throw failure;
      },
    };
    const outcome = await resolveUpstreamDescriptions({
      lsp,
      strict: true,
      uniqueId: TOTALS_DOWNSTREAM,
      columns: [
        { name: "grand_total", description: "" },
        { name: "total", description: "" },
        { name: "unused", description: "" },
      ],
      manifest,
    });
    expect(outcome).toEqual({
      kind: "failed",
      message: "listNodes timed out",
      error: failure,
      proposals: [
        {
          column: "grand_total",
          candidates: [
            {
              description: "Order total",
              sources: [
                {
                  uniqueId: "model.lineage_probe.order_totals",
                  column: "total",
                },
              ],
            },
          ],
        },
      ],
    });
    expect(calls).toEqual([
      columnLineageArgs(TOTALS_DOWNSTREAM, "grand_total"),
      columnLineageArgs(TOTALS_DOWNSTREAM, "total"),
    ]);
  });

  it("proposes the first described copy ancestor for each column without a description", async () => {
    const { lsp, calls } = fakeLsp();
    const columns: EditorColumn[] = [
      { name: "grand_total", description: "" },
      { name: "total", description: "Already set" },
    ];
    const outcome = await resolveUpstreamDescriptions({
      lsp,
      strict: true,
      uniqueId: TOTALS_DOWNSTREAM,
      columns,
      manifest,
    });
    expect(calls).toEqual([
      columnLineageArgs(TOTALS_DOWNSTREAM, "grand_total"),
    ]);
    expect(outcome).toEqual({
      kind: "found",
      asked: 1,
      proposals: [
        {
          column: "grand_total",
          candidates: [
            {
              description: "Order total",
              sources: [
                {
                  uniqueId: "model.lineage_probe.order_totals",
                  column: "total",
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("asks Fusion one column at a time, in editor order", async () => {
    const { lsp, calls } = fakeLsp();
    await resolveUpstreamDescriptions({
      lsp,
      strict: true,
      uniqueId: TOTALS_DOWNSTREAM,
      columns: [
        { name: "total", description: " " },
        { name: "grand_total", description: "" },
      ],
      manifest,
    });
    expect(calls).toEqual([
      columnLineageArgs(TOTALS_DOWNSTREAM, "total"),
      columnLineageArgs(TOTALS_DOWNSTREAM, "grand_total"),
    ]);
  });

  it("stops asking Fusion once the signal is aborted", async () => {
    const controller = new AbortController();
    const calls: (readonly string[])[] = [];
    const lsp = {
      state: "running" as const,
      listNodes: async (selectors: readonly string[]) => {
        calls.push(selectors);
        controller.abort();
        return FUSION_2_0_6_TOTAL;
      },
    };
    const outcome = await resolveUpstreamDescriptions({
      lsp,
      strict: true,
      uniqueId: TOTALS_DOWNSTREAM,
      columns: [
        { name: "total", description: "" },
        { name: "grand_total", description: "" },
      ],
      manifest,
      signal: controller.signal,
    });
    expect(calls).toEqual([columnLineageArgs(TOTALS_DOWNSTREAM, "total")]);
    expect(outcome.kind).toBe("found");
  });

  it("omits a column whose ancestors have no description", async () => {
    const { lsp } = fakeLsp();
    const outcome = await resolveUpstreamDescriptions({
      lsp,
      strict: true,
      uniqueId: STG_ORDERS,
      columns: [{ name: "amount", description: "" }],
      manifest,
    });
    expect(outcome).toEqual({ kind: "found", asked: 1, proposals: [] });
  });
});
