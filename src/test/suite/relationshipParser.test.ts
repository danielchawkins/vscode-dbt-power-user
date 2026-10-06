import { describe, expect, it } from "vitest";
import { RelationshipParser } from "../../core/manifest/relationshipParser";
import type {
  NodeMetaData,
  NodeMetaMap,
  SemanticModelMetaMap,
  SourceMetaMap,
  TestMetaMap,
} from "../../core/manifest/types";

const parser = new RelationshipParser({ debug: () => undefined });

const loose = <T>(value: unknown): T => value as T;

const nodeMap = (nodes: unknown[]): NodeMetaMap => ({
  lookupByBaseName: () => undefined,
  lookupByUniqueId: () => undefined,
  nodes: () => loose<NodeMetaData[]>(nodes),
});

const tests = (entries: Record<string, unknown>): TestMetaMap =>
  loose<TestMetaMap>(new Map(Object.entries(entries)));

const relationshipsTest = (overrides: Record<string, unknown> = {}) => ({
  unique_id: "test.rel",
  attached_node: "model.a",
  column_name: "b_id",
  depends_on: { nodes: ["model.b", "model.a"] },
  test_metadata: { name: "relationships", kwargs: { field: "id" } },
  ...overrides,
});

describe("RelationshipParser.fromTests", () => {
  it("orders endpoints by the attached node", () => {
    const [ref] = parser.fromTests(tests({ t: relationshipsTest() }));
    expect(ref).toMatchObject({
      id: "test:test.rel",
      from: { table: "model.a", columns: ["b_id"] },
      to: { table: "model.b", columns: ["id"] },
      cardinality: "many-to-one",
      source: "test",
    });
  });

  it("is one-to-one when the source column is also unique-tested", () => {
    const refs = parser.fromTests(
      tests({
        rel: relationshipsTest(),
        uq: {
          unique_id: "test.uq",
          attached_node: "model.a",
          column_name: "b_id",
          test_metadata: { name: "unique" },
        },
      }),
    );
    expect(refs).toHaveLength(1);
    expect(refs[0].cardinality).toBe("one-to-one");
  });

  it("honours meta overrides and the ignore flag", () => {
    const [ref] = parser.fromTests(
      tests({
        t: relationshipsTest({
          meta: { relationship_type: "one-to-many", relationship_label: "x" },
        }),
      }),
    );
    expect(ref).toMatchObject({ cardinality: "one-to-many", label: "x" });
    expect(
      parser.fromTests(
        tests({ t: relationshipsTest({ meta: { ignore_in_erd: true } }) }),
      ),
    ).toEqual([]);
  });

  it("skips other tests, missing columns and malformed endpoints", () => {
    expect(
      parser.fromTests(
        tests({
          other: relationshipsTest({ test_metadata: { name: "not_null" } }),
          noField: relationshipsTest({
            test_metadata: { name: "relationships", kwargs: {} },
          }),
          oneNode: relationshipsTest({ depends_on: { nodes: ["model.a"] } }),
        }),
      ),
    ).toEqual([]);
  });
});

describe("RelationshipParser.fromContracts", () => {
  const nodes = nodeMap([
    {
      unique_id: "model.orders",
      name: "orders",
      relation_name: '"db"."s"."Orders"',
      columns: {
        customer_id: {
          constraints: [
            { type: "foreign_key", to: "ref('customers')", to_columns: ["id"] },
          ],
        },
        ignored: {
          meta: { ignore_in_erd: true },
          constraints: [{ type: "foreign_key", to: "ref('customers')" }],
        },
      },
      constraints: [
        {
          type: "foreign_key",
          columns: ["a", "b"],
          to: "source('raw', 'payments')",
        },
      ],
    },
    { unique_id: "model.customers", name: "customers", columns: {} },
    {
      unique_id: "model.self",
      name: "self",
      columns: {
        pk: { constraints: [{ type: "primary_key" }] },
        other_id: {
          constraints: [{ type: "foreign_key", to: '"db"."s"."Orders"' }],
        },
      },
    },
  ]);
  const sources = loose<SourceMetaMap>(
    new Map([
      [
        "source.raw",
        {
          unique_id: "source.raw",
          name: "raw",
          tables: [{ name: "payments" }],
        },
      ],
    ]),
  );

  it("resolves ref, source and relation-name targets", () => {
    const refs = parser.fromContracts(nodes, sources);
    expect(refs.map((r) => r.id).sort()).toEqual([
      "contract:model.orders.[a,b]->source.raw",
      "contract:model.orders.customer_id->model.customers",
      "contract:model.self.other_id->model.orders",
    ]);
    const column = refs.find((r) => r.id.includes("customer_id"));
    expect(column?.to).toEqual({ table: "model.customers", columns: ["id"] });
    const modelLevel = refs.find((r) => r.id.includes("[a,b]"));
    expect(modelLevel?.to.columns).toEqual(["a", "b"]);
  });

  it("drops constraints whose target cannot be resolved", () => {
    expect(
      parser.fromContracts(
        nodeMap([
          {
            unique_id: "model.x",
            name: "x",
            columns: {
              c: { constraints: [{ type: "foreign_key", to: "ref('nope')" }] },
            },
          },
        ]),
      ),
    ).toEqual([]);
  });
});

describe("RelationshipParser.fromInference", () => {
  const nodes = nodeMap([
    { unique_id: "model.customer", name: "customer", columns: { id: {} } },
    {
      unique_id: "model.order",
      name: "order",
      columns: { customer_id: {}, order_id: {}, nothing_id: {} },
    },
  ]);

  it("links <x>_id columns to a table named <x>", () => {
    const refs = parser.fromInference(nodes, undefined);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      from: { table: "model.order", columns: ["customer_id"] },
      to: { table: "model.customer", columns: ["id"] },
      source: "inferred",
      confidence: 1,
    });
  });

  it("includes self references only on request", () => {
    expect(
      parser.fromInference(nodes, undefined, { allowSelfReference: true }),
    ).toHaveLength(2);
  });

  it("respects the confidence floor", () => {
    const plural = nodeMap([
      { unique_id: "model.customers", name: "customers", columns: { id: {} } },
      { unique_id: "model.o", name: "o", columns: { customer_id: {} } },
    ]);
    expect(parser.fromInference(plural, undefined)[0].confidence).toBe(0.8);
    expect(
      parser.fromInference(plural, undefined, { minConfidence: 0.9 }),
    ).toEqual([]);
  });
});

describe("RelationshipParser.fromSemanticEntities", () => {
  const sm = (
    id: string,
    model: string | undefined,
    entities: unknown[],
  ): [string, unknown] => [
    id,
    { unique_id: id, model_unique_id: model, entities },
  ];

  it("pairs foreign entities with primary ones across semantic models", () => {
    const map = loose<SemanticModelMetaMap>(
      new Map([
        sm("sm.orders", "model.orders", [
          { name: "customer", type: "foreign", expr: "customer_id" },
        ]),
        sm("sm.customers", "model.customers", [
          { name: "customer", type: "primary", expr: "id" },
        ]),
        sm("sm.unresolved", undefined, [{ name: "customer", type: "foreign" }]),
      ]),
    );
    expect(parser.fromSemanticEntities(map)).toEqual([
      {
        id: "semantic:sm.orders.customer->sm.customers",
        from: { table: "model.orders", columns: ["customer_id"] },
        to: { table: "model.customers", columns: ["id"] },
        cardinality: "many-to-one",
        source: "semantic",
      },
    ]);
  });

  it("returns nothing for an empty or absent map", () => {
    expect(parser.fromSemanticEntities(undefined)).toEqual([]);
    expect(parser.fromSemanticEntities(new Map())).toEqual([]);
  });
});
