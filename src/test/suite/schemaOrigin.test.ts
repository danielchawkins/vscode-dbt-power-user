import { describe, expect, it } from "@jest/globals";
import { SourceMetaMap } from "../../dbt_integration/domain";
import {
  hasProjectStrictAnalysis,
  hasSchemaOriginHook,
  resolveSchemaOrigin,
  SCHEMA_ORIGIN_HOOK,
} from "../../fusion/schemaOrigin";

const withHook = `name: p\nsources:\n  +schema_origin: "${SCHEMA_ORIGIN_HOOK}"\n`;
const v = (major: number, minor: number, patch: number) => ({
  major,
  minor,
  patch,
  raw: `dbt ${major}.${minor}.${patch}`,
});

function sources(
  tables: Record<string, Record<string, string | undefined> | undefined>,
): SourceMetaMap {
  return new Map([
    [
      "raw",
      {
        unique_id: "source.p.raw",
        name: "raw",
        database: "d",
        schema: "main",
        package_name: "p",
        is_external_project: false,
        meta: {},
        tables: Object.entries(tables).map(([name, columns]) => ({
          name,
          identifier: name,
          path: undefined,
          description: "",
          columns: Object.fromEntries(
            Object.entries(columns ?? {}).map(([column, dataType]) => [
              column,
              {
                name: column,
                description: "",
                data_type: dataType as string,
                meta: {},
              },
            ]),
          ),
        })),
      },
    ],
  ]);
}

describe("resolveSchemaOrigin", () => {
  it("is local with the hook, Fusion 2.0.6 and every source column typed", () => {
    expect(
      resolveSchemaOrigin({
        projectYaml: withHook,
        fusionVersion: v(2, 0, 6),
        sources: sources({ orders: { id: "integer", note: "varchar" } }),
      }),
    ).toEqual({ kind: "local" });
  });

  it("reports noHook first", () => {
    expect(
      resolveSchemaOrigin({
        projectYaml: "name: p\n",
        fusionVersion: v(2, 0, 5),
        sources: sources({ orders: {} }),
      }),
    ).toEqual({ kind: "noHook" });
  });

  it.each([
    [v(2, 0, 5), "2.0.5"],
    [undefined, "unknown"],
  ])("reports unsupportedFusion for %j", (fusionVersion, version) => {
    expect(
      resolveSchemaOrigin({
        projectYaml: withHook,
        fusionVersion,
        sources: sources({}),
      }),
    ).toEqual({ kind: "unsupportedFusion", version });
  });

  it("accepts later Fusion versions", () => {
    expect(
      resolveSchemaOrigin({
        projectYaml: withHook,
        fusionVersion: v(2, 1, 0),
        sources: sources({}),
      }).kind,
    ).toBe("local");
  });

  it("lists untyped columns and tables with no columns", () => {
    expect(
      resolveSchemaOrigin({
        projectYaml: withHook,
        fusionVersion: v(2, 0, 6),
        sources: sources({
          orders: { id: "integer", note: undefined, amount: "  " },
          contacts: undefined,
        }),
      }),
    ).toEqual({
      kind: "untypedSources",
      missing: [
        { source: "raw", table: "orders", column: "note" },
        { source: "raw", table: "orders", column: "amount" },
        { source: "raw", table: "contacts" },
      ],
    });
  });
});

describe("hasSchemaOriginHook", () => {
  it.each([
    [withHook, true],
    ["sources:\n  +schema_origin: local\n", false],
    ["name: p\n", false],
    ["sources: []\n", false],
  ])("%j -> %s", (yaml, expected) => {
    expect(hasSchemaOriginHook(yaml)).toBe(expected);
  });
});

describe("hasProjectStrictAnalysis", () => {
  it.each([
    ["name: p\nmodels:\n  p:\n    +static_analysis: strict\n", true],
    ["name: p\nmodels:\n  p:\n    +static_analysis: baseline\n", false],
    ["name: p\nmodels:\n  other:\n    +static_analysis: strict\n", false],
    ["name: p\nflags:\n  static_analysis: strict\n", false],
    ["models:\n  p:\n    +static_analysis: strict\n", false],
  ])("%j -> %s", (yaml, expected) => {
    expect(hasProjectStrictAnalysis(yaml)).toBe(expected);
  });
});
