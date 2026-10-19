import { describe, expect, it } from "vitest";
import { lineageTable } from "../../features/lineage/lineageTables";
import type { Manifest } from "../../projects/manifest/manifestTypes";

/** A manifest holding the given nodes, sources, functions and exposures; every other map is empty. */
function manifest(parts: {
  nodes?: Record<string, object>;
  sources?: Record<string, object>;
  functions?: Record<string, object>;
  exposures?: Record<string, object>;
}): Manifest {
  const nodes = new Map(Object.entries(parts.nodes ?? {}));
  return {
    nodeMetaMap: { lookupByUniqueId: (id: string) => nodes.get(id) },
    sourceMetaMap: new Map(Object.entries(parts.sources ?? {})),
    functionMetaMap: new Map(Object.entries(parts.functions ?? {})),
    exposureMetaMap: new Map(Object.entries(parts.exposures ?? {})),
    testMetaMap: new Map(),
    graphMetaMap: {
      children: new Map(),
      parents: new Map(),
      tests: new Map(),
    },
  } as unknown as Manifest;
}

const model = (over: Record<string, unknown> = {}) => ({
  name: "orders",
  alias: "orders",
  description: "",
  columns: {},
  package_name: "shop",
  database: "DEV_DB",
  schema: "DEV_DANIEL_COMMITMENT",
  config: {},
  patch_path: null,
  original_file_path: "models/orders.sql",
  tags: [],
  ...over,
});

const ORDERS = "model.shop.orders";

describe("lineage table hidden flag", () => {
  it("is set from meta.lineage.hidden on a model", () => {
    const event = manifest({
      nodes: {
        [ORDERS]: model({ meta: { lineage: { hidden: true } } }),
      },
    });
    expect(lineageTable(event, ORDERS)?.hidden).toBe(true);
  });

  it("is set from config.meta.lineage.hidden, where Fusion may put meta", () => {
    const event = manifest({
      nodes: {
        [ORDERS]: model({ config: { meta: { lineage: { hidden: true } } } }),
      },
    });
    expect(lineageTable(event, ORDERS)?.hidden).toBe(true);
  });

  it("is absent when the flag is false, not a boolean, or not set", () => {
    const flagged = (meta: unknown, config: object = {}) =>
      lineageTable(
        manifest({ nodes: { [ORDERS]: model({ meta, config }) } }),
        ORDERS,
      )?.hidden;
    expect(flagged({ lineage: { hidden: false } })).toBeUndefined();
    expect(flagged({ lineage: { hidden: "true" } })).toBeUndefined();
    expect(flagged({ lineage: "hidden" })).toBeUndefined();
    expect(flagged(undefined)).toBeUndefined();
    expect(flagged(undefined, { meta: { lineage: { hidden: false } } })).toBe(
      undefined,
    );
  });

  it("is set from a source table's own meta", () => {
    const event = manifest({
      sources: {
        raw: {
          name: "raw",
          package_name: "shop",
          database: "RAW",
          schema: "landing",
          tables: [
            {
              name: "events",
              columns: {},
              description: "",
              path: "",
              meta: { lineage: { hidden: true } },
            },
            { name: "users", columns: {}, description: "", path: "" },
          ],
        },
      },
    });
    expect(lineageTable(event, "source.shop.raw.events")?.hidden).toBe(true);
    expect(lineageTable(event, "source.shop.raw.users")?.hidden).toBe(
      undefined,
    );
  });

  it("is set from a function's and an exposure's meta", () => {
    const event = manifest({
      functions: {
        score: {
          config: { type: "scalar" },
          meta: { lineage: { hidden: true } },
        },
      },
      exposures: {
        dash: { meta: { lineage: { hidden: true } } },
      },
    });
    expect(lineageTable(event, "function.shop.score")?.hidden).toBe(true);
    expect(lineageTable(event, "exposure.shop.dash")?.hidden).toBe(true);
  });

  it("is set from a function's and an exposure's config.meta alone", () => {
    const event = manifest({
      functions: {
        score: {
          config: { type: "scalar", meta: { lineage: { hidden: true } } },
        },
      },
      exposures: {
        dash: { config: { meta: { lineage: { hidden: true } } } },
      },
    });
    expect(lineageTable(event, "function.shop.score")?.hidden).toBe(true);
    expect(lineageTable(event, "exposure.shop.dash")?.hidden).toBe(true);
  });
});

describe("lineage table custom schema", () => {
  it("passes the configured schema through as customSchema", () => {
    const event = manifest({
      nodes: {
        [ORDERS]: model({ config: { schema: "commitment" } }),
      },
    });
    const table = lineageTable(event, ORDERS);
    expect(table?.customSchema).toBe("commitment");
    expect(table?.schema).toBe("DEV_DANIEL_COMMITMENT");
  });

  it("leaves customSchema out when no schema is configured", () => {
    const event = manifest({ nodes: { [ORDERS]: model() } });
    expect(lineageTable(event, ORDERS)?.customSchema).toBeUndefined();
  });
});
