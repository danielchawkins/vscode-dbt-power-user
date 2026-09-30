import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { window } from "vscode";
import {
  parseHistoryArgs,
  ReplayProject,
  rerunFromHistory,
} from "../../commands/rerunFromHistory";
import { createEntry } from "../fixtures/runHistory";

function createProject(): jest.Mocked<ReplayProject> {
  return {
    runModel: jest.fn(),
    buildModel: jest.fn(),
    buildProject: jest.fn(),
    runTest: jest.fn(),
    compileModel: jest.fn(),
  } as unknown as jest.Mocked<ReplayProject>;
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
    jest.clearAllMocks();
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
