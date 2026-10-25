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
          tables: [
            { unique_id: "source.raw.payments", name: "payments" },
            { unique_id: "source.raw.refunds", name: "refunds" },
          ],
        },
      ],
    ]),
  );

  it("resolves ref, source and relation-name targets", () => {
    const refs = parser.fromContracts(nodes, sources);
    expect(refs.map((r) => r.id).sort()).toEqual([
      "contract:model.orders.[a,b]->source.raw.payments",
      "contract:model.orders.customer_id->model.customers",
      "contract:model.self.other_id->model.orders",
    ]);
    const column = refs.find((r) => r.id.includes("customer_id"));
    expect(column?.to).toEqual({ table: "model.customers", columns: ["id"] });
    const modelLevel = refs.find((r) => r.id.includes("[a,b]"));
    expect(modelLevel?.to.columns).toEqual(["a", "b"]);
  });

  it("points an FK at the source table it names, not the group's first table", () => {
    const refs = parser.fromContracts(
      nodeMap([
        {
          unique_id: "model.returns",
          name: "returns",
          columns: {},
          constraints: [
            {
              type: "foreign_key",
              columns: ["refund_id"],
              to: "source('raw', 'refunds')",
              to_columns: ["id"],
            },
          ],
        },
      ]),
      sources,
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]?.to).toEqual({
      table: "source.raw.refunds",
      columns: ["id"],
    });
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

  it("links to a source table's own id when includeSources is set", () => {
    const sources = loose<SourceMetaMap>(
      new Map([
        [
          "source.raw",
          {
            unique_id: "source.raw",
            name: "raw",
            tables: [
              {
                unique_id: "source.raw.payments",
                name: "payments",
                columns: { id: {} },
              },
              {
                unique_id: "source.raw.customer",
                name: "customer",
                columns: { id: {} },
              },
            ],
          },
        ],
      ]),
    );
    const orders = nodeMap([
      { unique_id: "model.order", name: "order", columns: { customer_id: {} } },
    ]);
    expect(parser.fromInference(orders, sources)).toEqual([]);
    expect(
      parser.fromInference(orders, sources, { includeSources: true }),
    ).toMatchObject([
      {
        from: { table: "model.order", columns: ["customer_id"] },
        to: { table: "source.raw.customer", columns: ["id"] },
      },
    ]);
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

describe("RelationshipParser.fromMeta", () => {
  const declared = (entries: unknown[]) => ({ relationships: entries });
  const nodes = nodeMap([
    {
      unique_id: "model.proj.orders",
      name: "orders",
      package_name: "proj",
      meta: declared([
        {
          from_columns: ["customer_id"],
          to: "ref('customers')",
          to_columns: ["id"],
        },
        {
          from_columns: ["region", "country"],
          to: "ref('nope')",
          to_columns: ["code", "iso"],
        },
        {
          from_columns: ["a"],
          to: "ref('customers')",
          to_columns: ["id"],
          cases: [{ when: "x", to: "ref('customers')" }],
        },
        {
          from_columns: ["b"],
          to_schema: "x",
          to_columns: ["id"],
        },
      ]),
    },
    {
      unique_id: "model.proj.customers",
      name: "customers",
      package_name: "proj",
    },
    {
      unique_id: "model.proj.invoices",
      name: "invoices",
      package_name: "proj",
      config: {
        meta: declared([
          {
            from_columns: ["payment_id"],
            to: "source('raw', 'payments')",
            to_columns: ["id"],
          },
        ]),
      },
    },
    {
      unique_id: "model.third.ambiguous",
      name: "ambiguous",
      package_name: "third",
      meta: declared([
        { from_columns: ["x"], to: "ref('dup')", to_columns: ["id"] },
      ]),
    },
    { unique_id: "model.proj.dup", name: "dup", package_name: "proj" },
    { unique_id: "model.other.dup", name: "dup", package_name: "other" },
  ]);
  const sources = loose<SourceMetaMap>(
    new Map([
      [
        "source.proj.raw",
        {
          unique_id: "source.proj.raw",
          name: "raw",
          package_name: "proj",
          tables: [
            {
              unique_id: "source.proj.raw.payments",
              name: "payments",
              meta: declared([
                {
                  from_columns: ["customer_id"],
                  to: "ref('customers')",
                  to_columns: ["id"],
                },
              ]),
            },
            {
              unique_id: "source.proj.raw.refunds",
              name: "refunds",
              configMeta: declared([
                {
                  from_columns: ["customer_id"],
                  to: "ref('customers')",
                  to_columns: ["id"],
                },
              ]),
            },
          ],
        },
      ],
    ]),
  );

  it("draws each resolvable declaration from the declaring side", () => {
    const refs = parser.fromMeta(nodes, sources);
    expect(refs).toEqual([
      {
        id: "meta:model.proj.orders[0]",
        from: { table: "model.proj.orders", columns: ["customer_id"] },
        to: { table: "model.proj.customers", columns: ["id"] },
        cardinality: "many-to-one",
        source: "meta",
      },
      {
        id: "meta:model.proj.invoices[0]",
        from: { table: "model.proj.invoices", columns: ["payment_id"] },
        to: { table: "source.proj.raw.payments", columns: ["id"] },
        cardinality: "many-to-one",
        source: "meta",
      },
      {
        id: "meta:source.proj.raw.payments[0]",
        from: { table: "source.proj.raw.payments", columns: ["customer_id"] },
        to: { table: "model.proj.customers", columns: ["id"] },
        cardinality: "many-to-one",
        source: "meta",
      },
      {
        id: "meta:source.proj.raw.refunds[0]",
        from: { table: "source.proj.raw.refunds", columns: ["customer_id"] },
        to: { table: "model.proj.customers", columns: ["id"] },
        cardinality: "many-to-one",
        source: "meta",
      },
    ]);
  });

  it("skips and debug-logs what does not resolve or is not supported", () => {
    const messages: string[] = [];
    const logging = new RelationshipParser({
      debug: (_category: string, message: string) => messages.push(message),
    });
    logging.fromMeta(nodes, sources);
    expect(messages).toContain(
      "Skipping meta.relationships[1] on model.proj.orders: cannot resolve ref('nope') to one node or source table",
    );
    expect(messages).toContain(
      "Skipping meta.relationships[2] on model.proj.orders: cases and to_schema are not supported",
    );
    expect(messages).toContain(
      "Skipping meta.relationships[3] on model.proj.orders: cases and to_schema are not supported",
    );
    expect(messages).toContain(
      "Skipping meta.relationships[0] on model.third.ambiguous: cannot resolve ref('dup') to one node or source table",
    );
    expect(messages).toContain("Derived 4 refs from meta.relationships");
  });

  it("prefers the declaring package when a model name is claimed by several packages", () => {
    const refs = parser.fromMeta(
      nodeMap([
        {
          unique_id: "model.proj.a",
          name: "a",
          package_name: "proj",
          meta: declared([
            { from_columns: ["x"], to: "ref('dup')", to_columns: ["id"] },
          ]),
        },
        { unique_id: "model.proj.dup", name: "dup", package_name: "proj" },
        { unique_id: "model.other.dup", name: "dup", package_name: "other" },
      ]),
    );
    expect(refs).toEqual([
      expect.objectContaining({
        id: "meta:model.proj.a[0]",
        to: { table: "model.proj.dup", columns: ["id"] },
      }),
    ]);
  });

  it("prefers the latest version of a versioned model among same-package claimants", () => {
    const version = (v: number, latest: number) => ({
      name: "orders",
      package_name: "proj",
      version: v,
      latest_version: latest,
    });
    const refs = parser.fromMeta(
      nodeMap([
        {
          unique_id: "model.proj.billing",
          name: "billing",
          package_name: "proj",
          meta: declared([
            {
              from_columns: ["order_id"],
              to: "ref('orders')",
              to_columns: ["id"],
            },
          ]),
        },
        { unique_id: "model.proj.orders.v1", ...version(1, 2) },
        { unique_id: "model.proj.orders.v2", ...version(2, 2) },
      ]),
    );
    expect(refs).toEqual([
      expect.objectContaining({
        from: { table: "model.proj.billing", columns: ["order_id"] },
        to: { table: "model.proj.orders.v2", columns: ["id"] },
      }),
    ]);
  });

  it("treats a name claimed by several packages as ambiguous when the declaring package claims none", () => {
    const refs = parser.fromMeta(
      nodeMap([
        {
          unique_id: "model.third.a",
          name: "a",
          package_name: "third",
          meta: declared([
            { from_columns: ["x"], to: "ref('dup')", to_columns: ["id"] },
          ]),
        },
        { unique_id: "model.proj.dup", name: "dup", package_name: "proj" },
        { unique_id: "model.other.dup", name: "dup", package_name: "other" },
      ]),
    );
    expect(refs).toEqual([]);
  });

  it("honours ignore_in_erd on the declaring node and skips malformed lists", () => {
    const refs = parser.fromMeta(
      nodeMap([
        {
          unique_id: "model.proj.ignored",
          name: "ignored",
          package_name: "proj",
          meta: {
            ignore_in_erd: true,
            relationships: [
              { from_columns: ["x"], to: "ref('c')", to_columns: ["id"] },
            ],
          },
        },
        {
          unique_id: "model.proj.bad",
          name: "bad",
          package_name: "proj",
          meta: declared([
            { from_columns: ["x", "y"], to: "ref('c')", to_columns: ["id"] },
          ]),
        },
        {
          unique_id: "model.proj.c",
          name: "c",
          package_name: "proj",
        },
        {
          unique_id: "model.proj.notalist",
          name: "notalist",
          package_name: "proj",
          meta: { relationships: "ref('c')" },
        },
      ]),
    );
    expect(refs).toEqual([]);
  });

  it("returns nothing for an absent node map", () => {
    expect(parser.fromMeta(undefined as unknown as NodeMetaMap)).toEqual([]);
  });
});
