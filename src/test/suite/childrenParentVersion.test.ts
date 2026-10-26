import { describe, expect, it } from "vitest";
import { ChildrenParentParser } from "../../core/manifest/childrenParentParser";

// Two versions of model `c` and a model `orders` whose foreign key names one of them. The FK is the only reason
// `orders` depends on a version, so `constraintOnlyParents` shows exactly which version the `to` resolved to.

const ORDERS = "model.p.orders";
const C_V1 = "model.p.c.v1";
const C_V2 = "model.p.c.v2";

function versionedNodes(to: string) {
  return {
    [ORDERS]: {
      unique_id: ORDERS,
      name: "orders",
      package_name: "p",
      relation_name: '"db"."s"."orders"',
      depends_on: { nodes: [C_V1, C_V2] },
      constraints: [{ type: "foreign_key" as const, columns: ["c_id"], to }],
      raw_code: "select 1",
    },
    [C_V1]: {
      unique_id: C_V1,
      name: "c",
      package_name: "p",
      version: 1,
      relation_name: '"db"."s"."c_v1"',
    },
    [C_V2]: {
      unique_id: C_V2,
      name: "c",
      package_name: "p",
      version: 2,
      relation_name: '"db"."s"."c_v2"',
    },
  };
}

async function constraintTargets(to: string): Promise<string[]> {
  const { constraintOnlyParents } =
    await new ChildrenParentParser().createChildrenParentMetaMap(
      versionedNodes(to),
    );
  return constraintOnlyParents[ORDERS] ?? [];
}

describe("lineage resolves a ref's version argument to that version", () => {
  const cases: Array<[string, string]> = [
    ["ref('c', version=2)", C_V2],
    ["ref('c', v = 2)", C_V2],
    ["ref('c', version = '2')", C_V2],
    ["ref('c', v=2)", C_V2],
    ["ref('c', 2)", C_V2],
    ["ref('c', v=1)", C_V1],
  ];
  for (const [to, target] of cases) {
    it(`${to} resolves to ${target} alone`, async () => {
      expect(await constraintTargets(to)).toEqual([target]);
    });
  }
});
