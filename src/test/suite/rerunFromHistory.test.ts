import { afterEach, describe, expect, it, type Mocked, vi } from "vitest";
import { window } from "vscode";
import {
  parseHistoryArgs,
  ReplayProject,
  rerunFromHistory,
} from "../../features/runHistory/rerunFromHistory";
import { parseRunResultsJson } from "../../projects/runResults";
import { createEntry } from "../fixtures/runHistory";

function createProject(): Mocked<ReplayProject> {
  return {
    runModel: vi.fn(),
    buildModel: vi.fn(),
    buildProject: vi.fn(),
    runTest: vi.fn(),
    compileModel: vi.fn(),
  } as unknown as Mocked<ReplayProject>;
}

describe("parseHistoryArgs", () => {
  it.each([
    ["model", "", "model", ""],
    ["+model", "+", "model", ""],
    ["model+", "", "model", "+"],
    ["+model+", "+", "model", "+"],
  ])("parses selector %s", (selector, left, modelName, right) => {
    expect(parseHistoryArgs([selector])).toEqual({
      plusOperatorLeft: left,
      modelName,
      plusOperatorRight: right,
    });
  });

  it("reads only the selector when a full-refresh flag follows", () => {
    expect(parseHistoryArgs(["+model", "--full-refresh"])).toEqual({
      plusOperatorLeft: "+",
      modelName: "model",
      plusOperatorRight: "",
    });
  });

  it("returns empty parameters for empty args", () => {
    expect(parseHistoryArgs([])).toEqual({
      plusOperatorLeft: "",
      modelName: "",
      plusOperatorRight: "",
    });
  });
});

describe("rerunFromHistory", () => {
  const project = createProject();
  const other = createProject();
  const findProjectByName = (name: string) =>
    ({ project1: project, project2: other })[name];

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reports a project that is not loaded", () => {
    rerunFromHistory(
      createEntry({ projectName: "missing", command: "dbt run" }),
      findProjectByName,
    );

    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("missing"),
    );
  });

  it.each(["dbt run", "dbt test", "dbt compile"])(
    "warns for project-wide %s",
    (command) => {
      rerunFromHistory(
        createEntry({ projectName: "project1", command, args: [] }),
        findProjectByName,
      );

      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining(command),
      );
    },
  );

  it("dispatches run, build, and test to the named project", () => {
    const replay = (command: string, args: string[]) =>
      rerunFromHistory(
        createEntry({ projectName: "project1", command, args }),
        findProjectByName,
      );

    replay("dbt run", ["model"]);
    replay("dbt build", ["+model+"]);
    replay("dbt build", []);
    replay("dbt test", ["unique_model"]);
    replay("dbt compile", ["+model"]);

    expect(project.runModel).toHaveBeenCalledWith({
      plusOperatorLeft: "",
      modelName: "model",
      plusOperatorRight: "",
    });
    expect(project.buildModel).toHaveBeenCalledWith({
      plusOperatorLeft: "+",
      modelName: "model",
      plusOperatorRight: "+",
    });
    expect(project.buildProject).toHaveBeenCalledTimes(1);
    expect(project.runTest).toHaveBeenCalledWith("unique_model");
    expect(project.compileModel).toHaveBeenCalledWith({
      plusOperatorLeft: "+",
      modelName: "model",
      plusOperatorRight: "",
    });
    for (const method of Object.values(other)) {
      expect(method).not.toHaveBeenCalled();
    }
  });

  it("dispatches runModel for a run whose selection came from launched args", () => {
    const entry = parseRunResultsJson(
      {
        metadata: { invocation_id: "i", generated_at: "2026-01-01T00:00:00Z" },
        args: { which: "run", full_refresh: false, static_analysis: "on" },
      },
      "project1",
      ["run", "--select", "stg_orders"],
    );

    rerunFromHistory(entry, findProjectByName);

    expect(project.runModel).toHaveBeenCalledWith({
      plusOperatorLeft: "",
      modelName: "stg_orders",
      plusOperatorRight: "",
    });
    expect(window.showWarningMessage).not.toHaveBeenCalled();
  });

  it("warns for unsupported commands", () => {
    rerunFromHistory(
      createEntry({ projectName: "project1", command: "dbt seed", args: [] }),
      findProjectByName,
    );

    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining("seed"),
    );
  });
});
