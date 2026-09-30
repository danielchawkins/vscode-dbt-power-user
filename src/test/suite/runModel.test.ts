import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import * as fs from "fs";
import { Uri, window } from "vscode";
import { RunModel } from "../../commands/runModel";
import { RunModelType } from "../../dbt_integration";
import { CurrentProject } from "../../projects/currentProject";
import { Project } from "../../projects/project";
import { DeclaredProject } from "../../projects/projectRegistry";
import { Projects } from "../../projects/projects";

const untitledUri = {
  scheme: "untitled",
  fsPath: "Untitled-1",
  path: "Untitled-1",
} as Uri;

describe("RunModel SQL execution", () => {
  let dbtProject: jest.Mocked<Project>;
  let projects: jest.Mocked<Projects>;
  let context: jest.Mocked<CurrentProject>;
  let runModel: RunModel;
  let project: DeclaredProject;

  beforeEach(() => {
    dbtProject = {
      executeSQLOnQueryPanel: jest.fn(),
    } as unknown as jest.Mocked<Project>;
    projects = {
      get: jest.fn().mockReturnValue(dbtProject),
    } as unknown as jest.Mocked<Projects>;
    context = {
      requireForCommand: jest.fn(),
    } as unknown as jest.Mocked<CurrentProject>;
    project = {
      root: Uri.file("/project"),
      name: "project",
      folder: { uri: Uri.file("/workspace"), name: "workspace", index: 0 },
      contains: () => true,
      dispose: jest.fn(),
    };
    runModel = new RunModel(projects, context);
  });

  afterEach(() => {
    (window.activeTextEditor as unknown) = undefined;
    jest.clearAllMocks();
  });

  it.each([Uri.file("/project/models/model.sql"), untitledUri])(
    "executes against the Current Project result for %s",
    async (uri) => {
      context.requireForCommand.mockResolvedValue(project);

      await runModel.executeSQL(uri, "select 1", "model");

      expect(context.requireForCommand).toHaveBeenCalledWith(uri);
      expect(projects.get).toHaveBeenCalledWith(project.root);
      expect(dbtProject.executeSQLOnQueryPanel).toHaveBeenCalledWith(
        "select 1",
        "model",
      );
    },
  );

  it("returns without execution when project selection is cancelled", async () => {
    context.requireForCommand.mockResolvedValue(undefined);

    await runModel.executeSQL(untitledUri, "select 1", "model");

    expect(dbtProject.executeSQLOnQueryPanel).not.toHaveBeenCalled();
  });

  it("awaits project resolution from the active-editor command", async () => {
    let resolveProject!: (project: DeclaredProject) => void;
    context.requireForCommand.mockReturnValue(
      new Promise((resolve) => {
        resolveProject = resolve;
      }),
    );
    (window.activeTextEditor as unknown) = {
      document: {
        uri: untitledUri,
        getText: jest.fn().mockReturnValue("select 1"),
      },
      selection: { isEmpty: true },
    };
    const execution = runModel.executeQueryOnActiveWindow();
    await Promise.resolve();
    expect(dbtProject.executeSQLOnQueryPanel).not.toHaveBeenCalled();
    resolveProject(project);
    await execution;

    expect(dbtProject.executeSQLOnQueryPanel).toHaveBeenCalledWith(
      "select 1",
      "Untitled-1",
    );
  });

  it("does nothing when no project owns the resolved root", async () => {
    context.requireForCommand.mockResolvedValue(project);
    projects.get.mockReturnValue(undefined);

    await runModel.executeSQL(untitledUri, "select 1", "model");

    expect(dbtProject.executeSQLOnQueryPanel).not.toHaveBeenCalled();
  });
});

describe("RunModel project commands", () => {
  const model = Uri.file("/project/models/orders.sql");
  let project: jest.Mocked<Project>;
  let projects: jest.Mocked<Projects>;
  let runModel: RunModel;

  beforeEach(() => {
    jest
      .spyOn(fs.realpathSync, "native")
      .mockImplementation((value) => value as string);
    project = {
      runModel: jest.fn(),
      buildModel: jest.fn(),
      compileModel: jest.fn(),
      compileQuery: jest.fn(),
      runTest: jest.fn(),
      runModelTest: jest.fn(),
      generateSchemaYML: jest.fn(),
      showRunSQL: jest.fn(),
    } as unknown as jest.Mocked<Project>;
    projects = {
      get: jest.fn().mockReturnValue(project),
    } as unknown as jest.Mocked<Projects>;
    runModel = new RunModel(projects, {} as CurrentProject);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const orders = {
    plusOperatorLeft: "",
    modelName: "orders",
    plusOperatorRight: "",
  };

  it("passes model params for run, build, and compile", () => {
    runModel.runDBTModel(model, RunModelType.RUN_PARENTS);
    runModel.buildDBTModel(model, RunModelType.BUILD_CHILDREN);
    runModel.compileDBTModel(model);

    expect(project.runModel).toHaveBeenCalledWith({
      ...orders,
      plusOperatorLeft: "+",
    });
    expect(project.buildModel).toHaveBeenCalledWith({
      ...orders,
      plusOperatorRight: "+",
    });
    expect(project.compileModel).toHaveBeenCalledWith(orders);
  });

  it("delegates query, test, schema, and run-SQL operations", () => {
    runModel.compileDBTQuery(model, "select 1");
    runModel.runDBTTest(model, "unique_orders");
    runModel.runDBTModelTest(model);
    runModel.generateSchemaYML(model);
    runModel.showRunSQL(model);

    expect(projects.get).toHaveBeenCalledWith(model);
    expect(project.compileQuery).toHaveBeenCalledWith("select 1");
    expect(project.runTest).toHaveBeenCalledWith("unique_orders");
    expect(project.runModelTest).toHaveBeenCalledWith("orders");
    expect(project.generateSchemaYML).toHaveBeenCalledWith(model, "orders");
    expect(project.showRunSQL).toHaveBeenCalledWith(model);
  });

  it("does nothing outside any project", () => {
    projects.get.mockReturnValue(undefined);

    runModel.runDBTModel(model);
    runModel.buildDBTModel(model);
    runModel.compileDBTModel(model);
    runModel.showRunSQL(model);

    expect(project.runModel).not.toHaveBeenCalled();
    expect(project.buildModel).not.toHaveBeenCalled();
    expect(project.compileModel).not.toHaveBeenCalled();
    expect(project.showRunSQL).not.toHaveBeenCalled();
  });
});
