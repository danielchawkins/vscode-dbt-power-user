import { describe, expect, it } from "vitest";
import type { Log } from "../../core/log";
import { ChildrenParentParser } from "../../core/manifest/childrenParentParser";
import type { ManifestProject } from "../../core/manifest/manifestProject";
import { buildRelationIndex } from "../../core/manifest/relationIndex";
import { RelationshipParser } from "../../core/manifest/relationshipParser";
import { SemanticModelParser } from "../../core/manifest/semanticModelParser";
import type {
  NodeMetaMap,
  SemanticModelResource,
  SourceMetaMap,
} from "../../core/manifest/types";

// One table of `to` strings, resolved by the lineage classification, the ERD's contract path and the semantic-model
// parser. Each case names the table it must reach.

const ORDERS = "model.p.orders";
const CUSTOMERS = "model.p.customers";
const PAYMENTS = "model.p.payments";
const T = "source.p.s.t";

const log = { debug: () => undefined } as unknown as Pick<Log, "debug">;
const project = {
  getProjectRoot: () => "/p",
  getProjectName: () => "p",
  paths: () => undefined,
} as ManifestProject;

interface Case {
  to: string;
  target: string;
}

const cases: Case[] = [
  { to: "ref('customers')", target: CUSTOMERS },
  { to: 'ref("customers")', target: CUSTOMERS },
  { to: "ref ('customers')", target: CUSTOMERS },
  { to: "ref('p', 'customers')", target: CUSTOMERS },
  { to: "ref('customers', v=2)", target: CUSTOMERS },
  { to: "source('s', 't')", target: T },
  { to: '"db"."s"."Payments"', target: PAYMENTS },
  { to: "db.s.Payments", target: PAYMENTS },
];

/** Raw manifest resources, as the lineage classification reads them. */
function lineageInput(to: string) {
  const nodes = {
    [ORDERS]: {
      unique_id: ORDERS,
      name: "orders",
      package_name: "p",
      relation_name: '"db"."s"."orders"',
      depends_on: { nodes: [CUSTOMERS, PAYMENTS, T] },
      constraints: [
        { type: "foreign_key" as const, columns: ["customer_id"], to },
      ],
      raw_code: "select 1",
    },
    [CUSTOMERS]: {
      unique_id: CUSTOMERS,
      name: "customers",
      package_name: "p",
      relation_name: '"db"."s"."customers"',
    },
    [PAYMENTS]: {
      unique_id: PAYMENTS,
      name: "payments",
      package_name: "p",
      relation_name: '"db"."s"."Payments"',
    },
  };
  const sources = {
    [T]: {
      unique_id: T,
      name: "t",
      source_name: "s",
      package_name: "p",
      relation_name: '"db"."s"."t"',
    },
  };
  return { nodes, sources };
}

/** The same graph as the ERD's node and source maps. */
function erdInput(to: string) {
  const node = (fields: Record<string, unknown>) => ({
    package_name: "p",
    columns: {},
    ...fields,
  });
  const nodes = [
    node({
      unique_id: ORDERS,
      name: "orders",
      relation_name: '"db"."s"."orders"',
      constraints: [{ type: "foreign_key", columns: ["customer_id"], to }],
    }),
    node({
      unique_id: CUSTOMERS,
      name: "customers",
      relation_name: '"db"."s"."customers"',
    }),
    node({
      unique_id: PAYMENTS,
      name: "payments",
      relation_name: '"db"."s"."Payments"',
    }),
  ];
  const sources: SourceMetaMap = new Map([
    [
      "source.p.s",
      {
        unique_id: "source.p.s",
        name: "s",
        package_name: "p",
        tables: [
          {
            unique_id: T,
            name: "t",
            columns: {},
            relation_name: '"db"."s"."t"',
          },
        ],
      },
    ],
  ]) as unknown as SourceMetaMap;
  const nodeMap = {
    lookupByBaseName: () => undefined,
    lookupByUniqueId: () => undefined,
    nodes: () => nodes,
  } as unknown as NodeMetaMap;
  return { nodeMap, sources };
}

async function lineageTarget(to: string): Promise<string[]> {
  const { nodes, sources } = lineageInput(to);
  const { constraintOnlyParents } =
    await new ChildrenParentParser().createChildrenParentMetaMap(
      nodes,
      sources,
    );
  return constraintOnlyParents[ORDERS] ?? [];
}

function erdTarget(to: string): string[] {
  const { nodeMap, sources } = erdInput(to);
  return new RelationshipParser(log)
    .fromContracts(nodeMap, sources)
    .map((ref) => ref.to.table);
}

async function semanticTarget(to: string): Promise<string | undefined> {
  const { nodeMap, sources } = erdInput(to);
  const semanticModels: Record<string, SemanticModelResource> = {
    "semantic_model.p.orders": {
      unique_id: "semantic_model.p.orders",
      name: "orders",
      package_name: "p",
      model: to,
      depends_on: { nodes: [] },
      entities: [],
    },
  };
  const map = await new SemanticModelParser(log).createSemanticModelMetaMap(
    semanticModels,
    project,
    buildRelationIndex(nodeMap, sources),
  );
  return map.get("semantic_model.p.orders")?.model_unique_id;
}

describe("ref and source targets agree across lineage, the ERD and semantic models", () => {
  for (const c of cases) {
    it(`lineage and the ERD resolve ${c.to} to ${c.target}`, async () => {
      expect(await lineageTarget(c.to)).toEqual([c.target]);
      expect(erdTarget(c.to)).toEqual([c.target]);
    });
  }
});

describe("the semantic-model parser resolves the same targets", () => {
  for (const c of cases) {
    it(`semantic model model: ${c.to} resolves to ${c.target}`, async () => {
      expect(await semanticTarget(c.to)).toBe(c.target);
    });
  }
});
