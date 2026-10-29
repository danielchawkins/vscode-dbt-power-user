import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ModelTestService } from "../../features/docs/modelTestService";

const SCHEMA = [
  "models:",
  "  - name: orders",
  "    tests:",
  "      - dbt_utils.unique_combination_of_columns:",
  "          combination_of_columns: [a, b]",
  "          severity: warn",
  "    columns:",
  "      - name: status",
  "        tests:",
  "          - accepted_values:",
  "              values: [a, b]",
  "              severity: warn",
  "",
].join("\n");

const setup = (over: { event?: unknown; document?: string } = {}) => {
  const root = mkdtempSync(path.join(tmpdir(), "dbttest-"));
  writeFileSync(path.join(root, "schema.yml"), SCHEMA);
  const log = { debug: () => undefined };
  const event = over.event ?? {
    nodeMetaMap: {
      lookupByBaseName: (name: string) =>
        name === "orders"
          ? { unique_id: "model.p.orders", patch_path: "p://schema.yml" }
          : undefined,
    },
    graphMetaMap: {
      tests: new Map([
        [
          "model.p.orders",
          {
            nodes: [
              { label: "a.x" },
              { label: "other.x" },
              { label: "singular.x" },
              { label: "missing.x" },
            ],
          },
        ],
      ]),
    },
    testMetaMap: new Map<string, unknown>([
      [
        "a",
        {
          attached_node: "model.p.orders",
          depends_on: { macros: ["macro.p.test_custom"] },
          test_metadata: { name: "custom" },
          path: "fallback.sql",
        },
      ],
      [
        "other",
        { attached_node: "model.p.elsewhere", depends_on: { macros: [] } },
      ],
      ["singular", { name: "singular" }],
    ]),
    macroMetaMap: new Map([["test_custom", { path: "macros/custom.sql" }]]),
    unitTestMetaMap: new Map([
      ["u1", { model: "orders", name: "ut1", path: "u.yml" }],
      ["u2", { model: "other", name: "ut2" }],
    ]),
  };
  const project = {
    log,
    manifest: event,
    root: { fsPath: root },
    getProjectName: () => "p",
  };
  const currentProject = {
    current: project,
    forResource: () => project,
    activeEditor: () => ({
      modelUri: { fsPath: over.document ?? "/x/orders.sql" },
      project,
    }),
  };
  const service = new ModelTestService(currentProject as never);
  return { service };
};

describe("ModelTestService", () => {
  it("removes duplicate tests by value", () => {
    const { service } = setup();
    expect(
      service.removeDuplicateTests(["a", { x: 1 }, "a", { x: 1 }, null, null]),
    ).toEqual(["a", { x: 1 }, null]);
  });

  describe("getConfigByTest", () => {
    it("returns extra column test config from the YAML, minus UI fields", () => {
      const { service } = setup();
      const yaml = service.getConfigByTest(
        {
          test_metadata: {
            name: "accepted_values",
            kwargs: { column_name: "status", values: ["a", "b"] },
          },
        } as never,
        "orders",
        { columnNameFromTestMetadata: "status" },
      );
      expect(yaml).toBe("severity: warn\n");
    });

    it("prefixes namespaced tests with their package", () => {
      const { service } = setup();
      const yaml = service.getConfigByTest(
        {
          test_metadata: {
            name: "unique_combination_of_columns",
            namespace: "dbt_utils",
            kwargs: { severity: "warn" },
          },
        } as never,
        "orders",
      );
      expect(yaml).toContain("dbt_utils.unique_combination_of_columns:");
      expect(yaml).toContain("severity: warn");
    });

    it("falls back to unsaved kwargs when the YAML has no such test", () => {
      const { service } = setup();
      const yaml = service.getConfigByTest(
        {
          test_metadata: {
            name: "not_null",
            kwargs: { model: "m", where: "x > 1" },
          },
        } as never,
        "orders",
        { columnNameFromTestMetadata: "status" },
      );
      expect(yaml).toBe("where: x > 1\n");
    });

    it("returns undefined for an unknown model", () => {
      const { service } = setup();
      expect(service.getConfigByTest({} as never, "nope")).toBeUndefined();
    });

    it("reads the given model's manifest, not the active editor's", () => {
      const { service } = setup();
      const activeEditor = vi.spyOn(
        (
          service as unknown as {
            currentProject: { activeEditor: () => unknown };
          }
        ).currentProject,
        "activeEditor",
      );
      const yaml = service.getConfigByTest(
        {
          test_metadata: {
            name: "accepted_values",
            kwargs: { column_name: "status", values: ["a", "b"] },
          },
        } as never,
        "orders",
        {
          columnNameFromTestMetadata: "status",
          uri: { fsPath: "/x/orders.sql" } as never,
        },
      );
      expect(yaml).toBe("severity: warn\n");
      expect(activeEditor).not.toHaveBeenCalled();
    });
  });

  describe("getTestsForModel", () => {
    it("keeps tests attached to the model and prefers the macro file path", async () => {
      const { service } = setup();
      const tests = await service.getTestsForModel("orders");
      expect(tests).toEqual([
        expect.objectContaining({ key: "a", path: "macros/custom.sql" }),
        expect.objectContaining({ key: "singular", name: "singular" }),
      ]);
    });

    it("returns undefined when the model has no node", async () => {
      const { service } = setup();
      expect(await service.getTestsForModel("nope")).toBeUndefined();
    });

    it("returns tests for the current document", async () => {
      const { service } = setup();
      expect(await service.getTestsForCurrentModel()).toHaveLength(2);
    });
  });

  it("lists unit tests for the current model only", async () => {
    const { service } = setup();
    expect(await service.getUnitTestsForCurrentModel()).toEqual([
      { name: "ut1", path: "u.yml" },
    ]);
  });
});
