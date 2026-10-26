import { describe, expect, it } from "vitest";
import {
  buildRelationIndex,
  resolveTarget,
} from "../../core/manifest/relationIndex";
import type { NodeMetaMap } from "../../core/manifest/types";

// Two packages that both define `customers`, and a versioned model `orders` (latest 2). `payments` has a mixed-case
// relation name, so a lowercase `to` can only match through the lowercased lookup.

const node = (fields: Record<string, unknown>) => ({
  columns: {},
  meta: {},
  config: { meta: {} },
  ...fields,
});

const nodes = [
  node({
    unique_id: "model.p.customers",
    name: "customers",
    package_name: "p",
    relation_name: '"db"."s"."customers"',
  }),
  node({
    unique_id: "model.other.customers",
    name: "customers",
    package_name: "other",
    relation_name: '"db"."o"."customers"',
  }),
  node({
    unique_id: "model.p.orders.v1",
    name: "orders",
    package_name: "p",
    version: 1,
    latest_version: 2,
    relation_name: '"db"."s"."orders_v1"',
  }),
  node({
    unique_id: "model.p.orders.v2",
    name: "orders",
    package_name: "p",
    version: 2,
    latest_version: 2,
    relation_name: '"db"."s"."orders_v2"',
  }),
  node({
    unique_id: "model.p.payments",
    name: "payments",
    package_name: "p",
    relation_name: '"db"."s"."Payments"',
  }),
];

const index = buildRelationIndex({
  nodes: () => nodes,
} as unknown as NodeMetaMap);

describe("resolveTarget picks the claimant a ref names", () => {
  it("resolves a two-argument ref to the named package, not the declaring one", () => {
    expect(resolveTarget("ref('other', 'customers')", index, "p")).toBe(
      "model.other.customers",
    );
  });

  it("resolves a one-argument ref to the declaring package's own node", () => {
    expect(resolveTarget("ref('customers')", index, "p")).toBe(
      "model.p.customers",
    );
    expect(resolveTarget("ref('customers')", index, "other")).toBe(
      "model.other.customers",
    );
  });

  it("resolves a version to the named version", () => {
    expect(resolveTarget("ref('orders', v=1)", index, "p")).toBe(
      "model.p.orders.v1",
    );
    expect(resolveTarget("ref('orders', version=2)", index, "p")).toBe(
      "model.p.orders.v2",
    );
  });

  it("resolves an unversioned ref to the latest version", () => {
    expect(resolveTarget("ref('orders')", index, "p")).toBe(
      "model.p.orders.v2",
    );
  });

  it("resolves nothing for a package that does not claim the name", () => {
    expect(resolveTarget("ref('other', 'orders')", index, "p")).toBeUndefined();
  });
});

describe("resolveTarget matches relation names as written, unquoted or lowercased", () => {
  it("matches a lowercased unquoted relation name", () => {
    expect(resolveTarget("db.s.payments", index, "p")).toBe("model.p.payments");
  });

  it("matches a lowercased quoted relation name", () => {
    expect(resolveTarget('"DB"."S"."PAYMENTS"', index, "p")).toBe(
      "model.p.payments",
    );
  });
});
