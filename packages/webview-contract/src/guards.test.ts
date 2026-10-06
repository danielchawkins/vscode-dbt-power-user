import {
  documentationEditor,
  lineage,
  queryResults,
} from "@fusion-power-user/webview-contract";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Fields, isString, nullish, optional } from "./guards.js";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** A valid message and the dotted paths whose removal or retyping must make it invalid. */
interface Fixture {
  message: { command: string } & Record<string, Json>;
  required: string[];
  /** Literal-union fields and every value each accepts. */
  literals?: Record<string, (string | number)[]>;
  /** Element-typed arrays and the JSON kinds their elements may have. */
  arrays?: Record<string, string[]>;
}

interface Direction {
  name: string;
  guard: (value: unknown) => boolean;
  commands: string[];
  fixtures: Fixture[];
}

/** Runs per property; fast-check prints the seed of a failing run. */
const NUM_RUNS = 2000;

const KEYS = [
  "command",
  "args",
  "params",
  "body",
  "syncRequestId",
  "query",
  "limit",
  "name",
  "__proto__",
  "",
];

const SPECIAL_STRINGS = [
  "",
  "x",
  "response",
  "render",
  "init",
  "error",
  "toString",
  "constructor",
  "__proto__",
  "日本",
];

const anyString = fc.oneof(fc.constantFrom(...SPECIAL_STRINGS), fc.string());

/** JSON values, biased toward objects keyed by the names messages use. */
const anyJson: fc.Arbitrary<Json> = fc.oneof(
  fc.jsonValue() as fc.Arbitrary<Json>,
  fc.dictionary(
    fc.constantFrom(...KEYS),
    fc.jsonValue() as fc.Arbitrary<Json>,
    {
      maxKeys: 5,
    },
  ),
);

const jsonKind = (value: unknown): string =>
  value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Applies `edit` to the parent object of `path`. */
const atPath = (
  message: Fixture["message"],
  path: string,
  edit: (parent: Record<string, Json>, key: string) => void,
) => {
  const keys = path.split(".");
  const last = keys.pop()!;
  const parent = keys.reduce(
    (node: Record<string, Json>, key) => node[key] as Record<string, Json>,
    message,
  );
  edit(parent, last);
};

const valueAt = (message: Fixture["message"], path: string): Json | undefined =>
  path
    .split(".")
    .reduce(
      (node: Json | undefined, key) =>
        (node as Record<string, Json> | undefined)?.[key],
      message,
    );

const sync = { syncRequestId: "id-1" };

const queryResultsHost: Fixture[] = [
  {
    message: {
      command: "response",
      args: { syncRequestId: "id-1", body: {}, status: true },
    },
    required: ["args", "args.status"],
  },
  {
    message: {
      command: "renderQuery",
      columnNames: ["a"],
      columnTypes: ["INT64", null],
      rows: [{ a: 1 }],
      raw_sql: "select 1",
      compiled_sql: "select 1",
    },
    required: ["columnNames", "columnTypes", "rows", "raw_sql", "compiled_sql"],
    arrays: {
      columnNames: ["string"],
      columnTypes: ["string", "null"],
      rows: ["object"],
    },
  },
  {
    message: {
      command: "renderError",
      error: { code: -1, message: "boom", data: {} },
      raw_sql: "select",
      compiled_sql: "select",
    },
    required: [
      "error",
      "error.code",
      "error.message",
      "raw_sql",
      "compiled_sql",
    ],
  },
  { message: { command: "renderLoading" }, required: [] },
  { message: { command: "resetState" }, required: [] },
  {
    message: {
      command: "getContext",
      limit: 500,
      activeEditor: { query: "", filepath: "/m.sql" },
    },
    required: ["limit", "activeEditor"],
  },
  {
    message: { command: "queryHistory", args: { body: [historyEntry()] } },
    required: ["args", "args.body", "args.body.0.rawSql"],
    arrays: { "args.body": ["object"], "args.body.0.data": ["object"] },
  },
  {
    message: { command: "updateViewType", args: { body: { type: 1 } } },
    required: ["args", "args.body", "args.body.type"],
    literals: { "args.body.type": [0, 1, 2] },
  },
];

function historyEntry(): Record<string, Json> {
  return {
    rawSql: "select 1",
    compiledSql: "select 1",
    timestamp: 1,
    duration: 2,
    adapter: "snowflake",
    projectName: "jaffle",
    data: [{ a: 1 }],
    columnNames: ["a"],
    columnTypes: [null],
    modelName: "orders",
  };
}

const queryResultsPanel: Fixture[] = [
  { message: { command: "webview:ready" }, required: [] },
  { message: { command: "error", text: "boom" }, required: ["text"] },
  {
    message: {
      command: "updateConfig",
      limit: 10,
    },
    required: [],
  },
  { message: { command: "cancelQuery" }, required: [] },
  { message: { command: "getQueryPanelContext" }, required: [] },
  { message: { command: "getQueryHistory" }, required: [] },
  {
    message: {
      command: "executeQuery",
      query: "select 1",
      projectName: "jaffle",
      editorName: "e",
    },
    required: ["query"],
  },
  {
    message: { command: "executeQueryFromActiveWindow", limit: 10 },
    required: ["limit"],
  },
  { message: { command: "getQueryTabData", ...sync }, required: [] },
  { message: { command: "runAdhocQuery" }, required: [] },
  {
    message: { command: "viewResultSet", queryHistory: historyEntry() },
    required: [
      "queryHistory",
      "queryHistory.rawSql",
      "queryHistory.duration",
      "queryHistory.columnTypes",
    ],
    arrays: {
      "queryHistory.data": ["object"],
      "queryHistory.columnNames": ["string"],
      "queryHistory.columnTypes": ["string", "null"],
    },
  },
  { message: { command: "openCodeInEditor", code: "select 1" }, required: [] },
  {
    message: { command: "clearQueryHistory", ...sync, error: {} },
    required: [],
  },
  {
    message: { command: "queryResultTab:render", queryTabData: {} },
    required: ["queryTabData"],
  },
];

const docs = {
  name: "orders",
  description: "",
  columns: [
    {
      name: "id",
      type: "int",
      description: "",
      generated: false,
      source: "YAML",
    },
  ],
  generated: false,
  filePath: "/models/orders.sql",
  patchPath: "/models/schema.yml",
  uniqueId: "model.jaffle.orders",
  resource_type: "model",
};

const columnSource = ["YAML", "DATABASE"];

const documentationHost: Fixture[] = [
  {
    message: {
      command: "response",
      args: { body: null, status: false, error: "no" },
    },
    required: ["args", "args.status"],
  },
  { message: { command: "renderError" }, required: [] },
  {
    message: {
      command: "renderDocumentation",
      docs,
      missingDocumentationMessage: { message: "m", type: "warning" },
      tests: [],
      unitTests: [],
      project: "jaffle",
      docBlocks: [{ name: "d", path: "/d.md" }],
      draft: { docs, tests: [] },
    },
    required: [
      "docBlocks",
      "docBlocks.0.path",
      "docs.name",
      "docs.columns",
      "docs.columns.0.name",
      "docs.filePath",
      "missingDocumentationMessage.message",
      "missingDocumentationMessage.type",
      "draft.docs",
      "draft.docs.name",
    ],
    literals: {
      "missingDocumentationMessage.type": ["warning", "error"],
      "docs.columns.0.source": columnSource,
    },
    arrays: { docBlocks: ["object"], "docs.columns": ["object"] },
  },
  {
    message: {
      command: "renderColumnsFromMetadataFetch",
      columns: [{ name: "id", type: "int" }],
    },
    required: ["columns", "columns.0.name"],
    arrays: { columns: ["object"] },
  },
];

const documentationPanel: Fixture[] = [
  { message: { command: "webview:ready" }, required: [] },
  { message: { command: "openProblemsTab" }, required: [] },
  {
    message: {
      command: "showInformationMessage",
      infoMessage: "?",
      items: ["Yes"],
      ...sync,
    },
    required: ["infoMessage"],
    arrays: { items: ["string"] },
  },
  {
    message: {
      command: "showWarningMessage",
      infoMessage: "?",
      items: [],
      ...sync,
    },
    required: ["infoMessage"],
  },
  { message: { command: "getCurrentModelDocumentation" }, required: [] },
  {
    message: { command: "saveDraft", model: "/m.sql", draft: { docs } },
    required: ["model", "draft.docs", "draft.docs.filePath"],
  },
  {
    message: {
      command: "getTestCode",
      test: { key: "t" },
      model: "orders",
      ...sync,
    },
    required: ["test", "model"],
  },
  {
    message: {
      command: "getUnitTestCode",
      path: "/u.yml",
      model: "orders",
      name: "t",
      ...sync,
    },
    required: [],
  },
  {
    message: {
      command: "getDistinctColumnValues",
      model: "orders",
      column: "id",
      ...sync,
    },
    required: ["column"],
  },
  {
    message: {
      command: "getColumnsOfSources",
      source: "raw",
      table: "t",
      ...sync,
    },
    required: ["source", "table"],
  },
  {
    message: { command: "getColumnsOfModel", model: "orders", ...sync },
    required: ["model"],
  },
  { message: { command: "getSourcesInProject", ...sync }, required: [] },
  { message: { command: "getModelsInProject", ...sync }, required: [] },
  { message: { command: "fetchMetadataFromDatabase", ...sync }, required: [] },
  {
    message: {
      command: "saveDocumentation",
      ...docs,
      updatedTests: [],
      dialogType: "New file",
      ...sync,
    },
    required: ["name", "columns", "columns.0.name", "filePath"],
    literals: {
      dialogType: ["Existing file", "New file"],
      "columns.0.source": columnSource,
    },
    arrays: { columns: ["object"] },
  },
];

const params = (value: Record<string, Json>) => ({
  args: { params: value },
  ...sync,
});

const lineageHost: Fixture[] = [
  {
    message: {
      command: "response",
      args: { syncRequestId: "1", body: {}, status: true },
    },
    required: ["args", "args.status"],
  },
  {
    message: {
      command: "render",
      args: {
        node: { table: "model.a" },
        missingLineageMessage: { message: "m", type: "warning" },
        publication: "s:1",
      },
    },
    required: ["args.missingLineageMessage.type"],
    literals: { "args.missingLineageMessage.type": ["warning", "error"] },
  },
  { message: { command: "projectSaved" }, required: [] },
];

const lineagePanel: Fixture[] = [
  { message: { command: "webview:ready" }, required: [] },
  { message: { command: "openProblemsTab" }, required: [] },
  { message: { command: "init", ...params({}) }, required: [] },
  {
    message: { command: "openFile", ...params({ url: "/m.sql" }) },
    required: ["args", "args.params", "args.params.url"],
  },
  {
    message: { command: "childTables", ...params({ table: "model.a" }) },
    required: ["args.params.table"],
  },
  {
    message: { command: "parentTables", ...params({ table: "model.a" }) },
    required: ["args.params.table"],
  },
  {
    message: {
      command: "getColumns",
      ...params({ table: "model.a", refresh: false }),
    },
    required: ["args.params.table"],
  },
  {
    message: { command: "getExposureDetails", ...params({ name: "e" }) },
    required: ["args.params.name"],
  },
  {
    message: { command: "getFunctionDetails", ...params({ name: "f" }) },
    required: ["args.params.name"],
  },
  {
    message: {
      command: "getRelationships",
      ...params({ includeSources: true }),
    },
    required: [],
  },
  {
    message: {
      command: "getConnectedColumns",
      ...params({
        targets: [["model.a", "id"]],
        upstreamExpansion: true,
      }),
    },
    required: [
      "args.params.targets",
      "args.params.targets.0.1",
      "args.params.upstreamExpansion",
    ],
    arrays: {
      "args.params.targets": ["array"],
      "args.params.targets.0": ["string"],
    },
  },
  { message: { command: "getLineageSettings", ...params({}) }, required: [] },
  {
    message: {
      command: "persistLineageSettings",
      ...params({
        showSelectEdges: true,
        showNonSelectEdges: false,
        defaultExpansion: 2,
        showRefs: true,
        enabledRefSources: { test: true, inferred: false },
        inferenceConfidenceThreshold: 0.6,
        includeSourcesInInference: false,
      }),
    },
    required: ["args.params"],
  },
];

const directions: Direction[] = [
  {
    name: "queryResults host",
    guard: queryResults.isHostMessage,
    commands: queryResults.hostCommands,
    fixtures: queryResultsHost,
  },
  {
    name: "queryResults panel",
    guard: queryResults.isPanelMessage,
    commands: queryResults.panelCommands,
    fixtures: queryResultsPanel,
  },
  {
    name: "documentationEditor host",
    guard: documentationEditor.isHostMessage,
    commands: documentationEditor.hostCommands,
    fixtures: documentationHost,
  },
  {
    name: "documentationEditor panel",
    guard: documentationEditor.isPanelMessage,
    commands: documentationEditor.panelCommands,
    fixtures: documentationPanel,
  },
  {
    name: "lineage host",
    guard: lineage.isHostMessage,
    commands: lineage.hostCommands,
    fixtures: lineageHost,
  },
  {
    name: "lineage panel",
    guard: lineage.isPanelMessage,
    commands: lineage.panelCommands,
    fixtures: lineagePanel,
  },
];

describe.each(directions)("$name guard", ({ guard, commands, fixtures }) => {
  it("has a fixture for every command", () => {
    expect(fixtures.map((f) => f.message.command).sort()).toEqual(
      [...commands].sort(),
    );
  });

  it.each(fixtures.map((f) => [f.message.command, f] as const))(
    "accepts a well-formed %s",
    (_command, fixture) => {
      expect(guard(fixture.message)).toBe(true);
      expect(guard(JSON.parse(JSON.stringify(fixture.message)))).toBe(true);
    },
  );

  it("rejects non-object and unknown-command values", () => {
    for (const value of [
      undefined,
      null,
      0,
      "response",
      [],
      [{ command: commands[0] }],
      { command: 1 },
      {},
    ]) {
      expect(guard(value)).toBe(false);
    }
    expect(guard({ command: "toString" })).toBe(false);
    expect(guard({ command: "__proto__" })).toBe(false);
    expect(guard(Object.create({ command: commands[0] }))).toBe(false);
  });

  it("rejects a non-string syncRequestId where a command declares one", () => {
    for (const fixture of fixtures.filter(
      (f) => "syncRequestId" in f.message,
    )) {
      expect(guard({ ...fixture.message, syncRequestId: 7 })).toBe(false);
    }
  });

  it("rejects each literal-union field set to a same-kind value outside the union", () => {
    for (const fixture of fixtures) {
      for (const [path, allowed] of Object.entries(fixture.literals ?? {})) {
        expect(guard(fixture.message), path).toBe(true);
        for (const value of allowed) {
          const message = clone(fixture.message);
          atPath(message, path, (parent, key) => (parent[key] = value));
          expect(guard(message), `${path} = ${value}`).toBe(true);
        }
        const wrong =
          typeof allowed[0] === "number"
            ? [-1, 3, 1.5, Math.max(...(allowed as number[])) + 1]
            : [
                "",
                "x",
                "Warning",
                `${allowed[0]} `,
                String(allowed[0]).toUpperCase(),
              ];
        for (const value of wrong.filter((v) => !allowed.includes(v))) {
          const message = clone(fixture.message);
          atPath(message, path, (parent, key) => (parent[key] = value));
          expect(
            guard(message),
            `${fixture.message.command}.${path} = ${JSON.stringify(value)}`,
          ).toBe(false);
        }
      }
    }
  });

  it("rejects an element-typed array holding an element of the wrong kind", () => {
    const cases = fixtures.flatMap((fixture) =>
      Object.entries(fixture.arrays ?? {}).map(
        ([path, kinds]) => [fixture, path, kinds] as const,
      ),
    );
    for (const [fixture, path] of cases) {
      expect(Array.isArray(valueAt(fixture.message, path)), path).toBe(true);
    }
    if (cases.length === 0) {
      return;
    }
    fc.assert(
      fc.property(
        fc.constantFrom(...cases),
        anyJson,
        fc.nat(),
        ([fixture, path, kinds], element, at) => {
          fc.pre(!kinds.includes(jsonKind(element)));
          const message = clone(fixture.message);
          atPath(message, path, (parent, key) => {
            const items = parent[key] as Json[];
            items.splice(at % (items.length + 1), 0, element);
          });
          expect(
            guard(message),
            `${fixture.message.command}.${path} with ${JSON.stringify(element)}`,
          ).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS / 4 },
    );
  });

  it("rejects each fixture with a required field removed", () => {
    for (const fixture of fixtures) {
      for (const path of fixture.required) {
        const message = clone(fixture.message);
        atPath(message, path, (parent, key) => delete parent[key]);
        expect(
          guard(message),
          `${fixture.message.command} without ${path}`,
        ).toBe(false);
      }
    }
  });

  it("rejects arbitrary JSON in place of a required field", () => {
    const cases = fixtures.flatMap((fixture) =>
      fixture.required.map((path) => [fixture, path] as const),
    );
    if (cases.length === 0) {
      return;
    }
    fc.assert(
      fc.property(
        fc.constantFrom(...cases),
        anyJson,
        ([fixture, path], replacement) => {
          fc.pre(
            jsonKind(replacement) !== jsonKind(valueAt(fixture.message, path)),
          );
          const message = clone(fixture.message);
          atPath(message, path, (parent, key) => (parent[key] = replacement));
          expect(
            guard(message),
            `${fixture.message.command}.${path} = ${JSON.stringify(replacement)}`,
          ).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("accepts arbitrary JSON only when its command is known and the guard is stable across a JSON round trip", () => {
    const withCommand = fc
      .tuple(
        fc.dictionary(
          fc.constantFrom(...KEYS),
          fc.jsonValue() as fc.Arbitrary<Json>,
          {
            maxKeys: 5,
          },
        ),
        fc.oneof(
          { weight: 4, arbitrary: fc.constantFrom(...commands) },
          { weight: 1, arbitrary: anyString },
        ),
      )
      .map(([value, command]) => ({ ...value, command }));
    fc.assert(
      fc.property(fc.oneof(anyJson, withCommand), (value) => {
        if (!guard(value)) {
          return;
        }
        const command = (value as { command: string }).command;
        expect(commands).toContain(command);
        expect(guard(JSON.parse(JSON.stringify(value)))).toBe(true);
        const fixture = fixtures.find((f) => f.message.command === command)!;
        for (const path of fixture.required.filter((p) => !p.includes("."))) {
          expect(value, `${command} accepted without ${path}`).toHaveProperty(
            path,
          );
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe("lineage requestCommands", () => {
  it("lists exactly the panel commands whose fixture accepts a syncRequestId", () => {
    const answered = lineagePanel
      .filter((f) => lineage.isPanelMessage({ ...f.message, ...sync }))
      .filter(
        (f) => !lineage.isPanelMessage({ ...f.message, syncRequestId: 7 }),
      )
      .map((f) => f.message.command);
    expect([...lineage.requestCommands].sort()).toEqual(answered.sort());
    expect(lineage.requestCommands).not.toContain("webview:ready");
    expect(lineage.requestCommands).not.toContain("openProblemsTab");
  });
});

describe("Fields", () => {
  interface Nullable {
    a?: string | null;
    b: string;
  }

  it("accepts null on a nullish field and absence on an optional one", () => {
    expect(nullish(isString)(null)).toBe(true);
    expect(nullish(isString)(undefined)).toBe(true);
    expect(optional(isString)(null)).toBe(false);
  });

  it("rejects at compile time a check stricter, looser or extra to its field", () => {
    const exact: Fields<Nullable> = { a: nullish(isString), b: isString };
    // @ts-expect-error `optional` rejects the `null` the field allows
    const stricter: Fields<Nullable> = { a: optional(isString), b: isString };
    // @ts-expect-error `optional` accepts the `undefined` the field forbids
    const looser: Fields<Pick<Nullable, "b">> = { b: optional(isString) };
    // @ts-expect-error `c` is not a field
    const extra: Fields<Pick<Nullable, "b">> = { b: isString, c: isString };
    // @ts-expect-error `b` has no check
    const missing: Fields<Nullable> = { a: nullish(isString) };
    expect([exact, stricter, looser, extra, missing]).toHaveLength(5);
  });
});

describe("documentationEditor null fields", () => {
  const nulled = {
    ...docs,
    description: null,
    patchPath: null,
    columns: [{ name: "id", type: null, description: null }],
  };

  it("accepts the nulls a manifest carries on documentation", () => {
    expect(
      documentationEditor.isHostMessage({
        command: "renderDocumentation",
        docs: nulled,
        docBlocks: [],
      }),
    ).toBe(true);
    expect(
      documentationEditor.isPanelMessage({
        command: "saveDocumentation",
        ...nulled,
        ...sync,
      }),
    ).toBe(true);
  });

  it("accepts getDistinctColumnValues before a model is loaded", () => {
    for (const model of [null, undefined]) {
      expect(
        documentationEditor.isPanelMessage({
          command: "getDistinctColumnValues",
          model,
          column: "id",
          ...sync,
        }),
      ).toBe(true);
    }
  });
});
