import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { Uri } from "vscode";
import { parse } from "yaml";
import { DbtTestService } from "../../features/docs/dbtTestService";
import { DocsEditViewPanel } from "../../features/docs/docsEditPanel";

type TestData = { tests?: unknown[]; data_tests?: unknown[] } | undefined;

interface TestKeyPanel {
  getTestDataByModel(
    message: unknown,
    modelName: string,
    existingModel?: unknown,
  ): TestData;
  getTestDataByColumn(
    message: unknown,
    column: string,
    existingColumn?: unknown,
  ): TestData;
  saveDocumentation(message: unknown, syncRequestId: string): Promise<void>;
}

const modelTest = {
  test_metadata: { name: "unique_combo", kwargs: { model: "orders" } },
};
const columnTest = {
  column_name: "id",
  test_metadata: { name: "not_null", kwargs: { column_name: "id" } },
};

function testKeyPanel(panelClass: typeof DocsEditViewPanel): TestKeyPanel {
  const project = {
    projectRoot: Uri.file("/project"),
    getAdapterType: () => "duckdb",
  };
  const instance = Object.create(panelClass.prototype);
  instance.dbtTestService = Object.create(DbtTestService.prototype);
  instance.terminal = { debug: jest.fn(), error: jest.fn() };
  instance.projects = { get: () => project };
  instance.getProject = () => project;
  return instance as TestKeyPanel;
}

describe("docs editor test key", () => {
  let panel: TestKeyPanel;

  beforeEach(() => {
    panel = testKeyPanel(DocsEditViewPanel);
  });

  it("writes data_tests for a model whose YAML has no tests key", () => {
    const message = { updatedTests: [modelTest] };
    expect(panel.getTestDataByModel(message, "orders", {})).toEqual({
      data_tests: ["unique_combo"],
    });
    expect(panel.getTestDataByModel(message, "orders")).toEqual({
      data_tests: ["unique_combo"],
    });
  });

  it("keeps tests for a model whose YAML already uses tests", () => {
    const message = { updatedTests: [modelTest] };
    expect(panel.getTestDataByModel(message, "orders", { tests: [] })).toEqual({
      tests: ["unique_combo"],
    });
  });

  it("writes data_tests for an existing column without a tests key", () => {
    const message = { updatedTests: [columnTest] };
    expect(panel.getTestDataByColumn(message, "id", { name: "id" })).toEqual({
      data_tests: ["not_null"],
    });
  });

  it("keeps tests for a column whose YAML already uses tests", () => {
    const message = { updatedTests: [columnTest] };
    expect(
      panel.getTestDataByColumn(message, "id", { name: "id", tests: [] }),
    ).toEqual({ tests: ["not_null"] });
  });
});

describe("docs editor save", () => {
  const schemaYaml =
    "models:\n  - name: orders\n    columns:\n      - name: amount\n";
  const writeFileSync = jest.fn();
  let panel: TestKeyPanel;

  beforeEach(async () => {
    jest.resetModules();
    jest.unstable_mockModule("fs", () => ({
      ...(jest.requireActual("fs") as typeof import("fs")),
      existsSync: () => true,
      readFileSync: () => Buffer.from(schemaYaml),
      writeFileSync,
    }));
    const { DocsEditViewPanel: panelClass } =
      await import("../../features/docs/docsEditPanel");
    panel = testKeyPanel(panelClass);
  });

  afterEach(async () => {
    writeFileSync.mockReset();
    jest.resetModules();
    jest.unstable_unmockModule("fs");
  });

  it("writes data_tests for a column added to a model that already has YAML", async () => {
    await panel.saveDocumentation(
      {
        name: "orders",
        filePath: "/project/models/orders.sql",
        patchPath: "project://models/schema.yml",
        columns: [{ name: "id" }],
        updatedTests: [columnTest],
      },
      "",
    );

    const written = parse(String(writeFileSync.mock.calls[0][1]));
    expect(written.models[0].columns[1]).toEqual({
      name: "id",
      data_tests: ["not_null"],
    });
  });
});
