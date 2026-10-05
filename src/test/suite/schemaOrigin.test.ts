import { describe, expect, it } from "vitest";
import { SourceMetaMap } from "../../core/manifest/types";
import { parseDbtProjectYaml } from "../../core/project";
import {
  hasProjectStrictAnalysis,
  hasSchemaOriginHook,
  resolveSchemaOrigin,
  SCHEMA_ORIGIN_HOOK,
  schemaOriginEnv,
  schemaOriginLaunchEnv,
} from "../../projects/schemaOrigin";

const withHook = `name: p\nsources:\n  +schema_origin: "${SCHEMA_ORIGIN_HOOK}"\n`;
const config = (yaml: string) => parseDbtProjectYaml(yaml).config;

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
  it("is local with the hook and every source column typed", () => {
    expect(
      resolveSchemaOrigin({
        projectConfig: config(withHook),
        sources: sources({ orders: { id: "integer", note: "varchar" } }),
      }),
    ).toEqual({ kind: "local" });
  });

  it("reports noHook first", () => {
    expect(
      resolveSchemaOrigin({
        projectConfig: config("name: p\n"),
        sources: sources({ orders: {} }),
      }),
    ).toEqual({ kind: "noHook" });
  });

  it("lists untyped columns and tables with no columns", () => {
    expect(
      resolveSchemaOrigin({
        projectConfig: config(withHook),
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
    [`${withHook}bad: [\n`, false],
  ])("%j -> %s", (yaml, expected) => {
    expect(hasSchemaOriginHook(config(yaml))).toBe(expected);
  });
});

describe("hasProjectStrictAnalysis", () => {
  it.each([
    ["name: p\nmodels:\n  p:\n    +static_analysis: strict\n", true],
    ["name: p\nmodels:\n  p:\n    +static_analysis: baseline\n", false],
    ["name: p\nmodels:\n  other:\n    +static_analysis: strict\n", false],
    ["name: p\nflags:\n  static_analysis: strict\n", false],
    ["models:\n  p:\n    +static_analysis: strict\n", false],
    ["name: p\nmodels:\n  p:\n    +static_analysis: strict\nbad: [\n", false],
  ])("%j -> %s", (yaml, expected) => {
    expect(hasProjectStrictAnalysis(config(yaml))).toBe(expected);
  });
});

describe("schemaOriginEnv", () => {
  it("always sets the origin: local only for a warehouse-free project", () => {
    expect(schemaOriginEnv({ kind: "local" })).toEqual({
      FUSION_POWER_USER_SCHEMA_ORIGIN: "local",
    });
    expect(schemaOriginEnv({ kind: "noHook" })).toEqual({
      FUSION_POWER_USER_SCHEMA_ORIGIN: "remote",
    });
    expect(schemaOriginEnv({ kind: "untypedSources", missing: [] })).toEqual({
      FUSION_POWER_USER_SCHEMA_ORIGIN: "remote",
    });
  });
});

describe("schemaOriginLaunchEnv", () => {
  const project = (snapshot: unknown, kind: "local" | "noHook") => ({
    manifest: snapshot,
    schemaOriginStatus: () => ({ kind }) as const,
  });

  it("is remote before the project's first parse", () => {
    expect(schemaOriginLaunchEnv(undefined)).toEqual({
      FUSION_POWER_USER_SCHEMA_ORIGIN: "remote",
    });
    expect(schemaOriginLaunchEnv(project(undefined, "local"))).toEqual({
      FUSION_POWER_USER_SCHEMA_ORIGIN: "remote",
    });
  });

  it("follows the project's status after a parse", () => {
    expect(schemaOriginLaunchEnv(project({}, "local"))).toEqual({
      FUSION_POWER_USER_SCHEMA_ORIGIN: "local",
    });
    expect(schemaOriginLaunchEnv(project({}, "noHook"))).toEqual({
      FUSION_POWER_USER_SCHEMA_ORIGIN: "remote",
    });
  });
});
