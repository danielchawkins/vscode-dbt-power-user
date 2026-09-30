import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Uri, window } from "vscode";
import { RunTest } from "../../commands/runTest";
import { Manifest } from "../../projects/manifestTypes";
import { Project } from "../../projects/project";
import { Projects } from "../../projects/projects";
import { QueryManifestService } from "../../services/queryManifestService";

/**
 * Regression tests for issue #1720.
 *
 * `RunTest` classifies active files using the parsed manifest and runs
 * singular data tests via `dbt test --select <test_name>`. The command
 * registrations in `src/commands/index.ts` consult `RunTest` first and
 * delegate to `RunModel` only when the active file is not a singular test.
 * These tests cover the classification + dispatch logic of `RunTest`
 * itself — the command-layer dispatch is exercised by integration testing.
 */
describe("RunTest — singular test classification and dispatch", () => {
  let mockProject: jest.Mocked<Project>;
  let mockProjects: jest.Mocked<Projects>;
  let mockQueryManifestService: jest.Mocked<QueryManifestService>;
  let runTest: RunTest;

  const singularTestPath =
    "/workspace/jaffle/tests/singular_nonnull_orders.sql";
  const modelPath = "/workspace/jaffle/models/marts/orders.sql";

  const makeEvent = (): Manifest => {
    const testMetaMap = new Map<string, any>();
    // Singular test: no test_metadata, path matches file on disk.
    testMetaMap.set("singular_nonnull_orders", {
      path: singularTestPath,
      database: "db",
      schema: "analytics",
      alias: "singular_nonnull_orders",
      raw_sql: "select * from {{ ref('orders') }} where customer_id is null",
      depends_on: { macros: [], nodes: [], sources: [] },
      unique_id: "test.jaffle.singular_nonnull_orders",
    });
    // Generic test: has test_metadata, should not match even if path matches
    // (generic tests live in schema.yml, not .sql files).
    testMetaMap.set("not_null_orders_customer_id", {
      path: "/workspace/jaffle/models/marts/schema.yml",
      database: "db",
      schema: "analytics",
      alias: "not_null_orders_customer_id",
      raw_sql: "",
      test_metadata: { name: "not_null", kwargs: {} as any },
      attached_node: "model.jaffle.orders",
      depends_on: { macros: [], nodes: [], sources: [] },
      unique_id: "test.jaffle.not_null_orders_customer_id",
    });

    return {
      project: {} as any,
      nodeMetaMap: new Map() as any,
      macroMetaMap: new Map() as any,
      metricMetaMap: new Map() as any,
      sourceMetaMap: new Map() as any,
      graphMetaMap: {} as any,
      testMetaMap: testMetaMap as any,
      unitTestMetaMap: new Map() as any,
      docMetaMap: new Map() as any,
      exposureMetaMap: new Map() as any,
      functionMetaMap: new Map() as any,
      semanticModelMetaMap: new Map() as any,
      modelDepthMap: new Map() as any,
      publicationEpoch: 1,
      metadataProducer: "manifest",
    };
  };

  const setActiveEditor = (fsPath: string | null) => {
    Object.defineProperty(window, "activeTextEditor", {
      value:
        fsPath === null
          ? undefined
          : {
              document: {
                uri: Uri.file(fsPath),
              },
            },
      writable: true,
      configurable: true,
    });
  };

  beforeEach(() => {
    mockProject = { runTest: jest.fn() } as unknown as jest.Mocked<Project>;
    mockProjects = {
      get: jest.fn().mockReturnValue(mockProject),
    } as unknown as jest.Mocked<Projects>;

    mockQueryManifestService = {
      getEventByDocument: jest.fn().mockReturnValue(makeEvent()),
    } as unknown as jest.Mocked<QueryManifestService>;

    runTest = new RunTest(mockProjects, mockQueryManifestService);
  });

  describe("getSingularTestName", () => {
    it("returns the test name for a singular test file", () => {
      expect(runTest.getSingularTestName(Uri.file(singularTestPath))).toBe(
        "singular_nonnull_orders",
      );
    });

    it("returns undefined for a regular model file", () => {
      expect(runTest.getSingularTestName(Uri.file(modelPath))).toBeUndefined();
    });

    it("returns undefined for a generic test (has test_metadata)", () => {
      // Generic tests live in schema.yml; their path would never match a
      // .sql file the user is editing, but the test_metadata filter is the
      // authoritative guard.
      expect(
        runTest.getSingularTestName(
          Uri.file("/workspace/jaffle/models/marts/schema.yml"),
        ),
      ).toBeUndefined();
    });

    it("returns undefined when the manifest event is missing", () => {
      mockQueryManifestService.getEventByDocument = jest
        .fn()
        .mockReturnValue(undefined) as any;
      expect(
        runTest.getSingularTestName(Uri.file(singularTestPath)),
      ).toBeUndefined();
    });
  });

  describe("runSingularTestOnActiveWindowIfApplicable", () => {
    it("dispatches runTest and returns true for a singular test file", () => {
      setActiveEditor(singularTestPath);

      const dispatched = runTest.runSingularTestOnActiveWindowIfApplicable();

      expect(dispatched).toBe(true);
      expect(mockProjects.get).toHaveBeenCalledWith(expect.anything());
      expect(mockProject.runTest).toHaveBeenCalledWith(
        "singular_nonnull_orders",
      );
    });

    it("returns false for a regular model file (caller falls back to RunModel)", () => {
      setActiveEditor(modelPath);

      const dispatched = runTest.runSingularTestOnActiveWindowIfApplicable();

      expect(dispatched).toBe(false);
      expect(mockProject.runTest).not.toHaveBeenCalled();
    });

    it("returns false when there is no active editor", () => {
      setActiveEditor(null);

      const dispatched = runTest.runSingularTestOnActiveWindowIfApplicable();

      expect(dispatched).toBe(false);
      expect(mockProject.runTest).not.toHaveBeenCalled();
    });

    it("returns false when the manifest has no matching test", () => {
      setActiveEditor(singularTestPath);
      mockQueryManifestService.getEventByDocument = jest
        .fn()
        .mockReturnValue(undefined) as any;

      const dispatched = runTest.runSingularTestOnActiveWindowIfApplicable();

      expect(dispatched).toBe(false);
      expect(mockProject.runTest).not.toHaveBeenCalled();
    });
  });
});
