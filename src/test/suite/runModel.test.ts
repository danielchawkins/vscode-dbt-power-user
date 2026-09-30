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
import { DBTProject } from "../../dbt_client/dbtProject";
import { DBTProjectContainer } from "../../dbt_client/dbtProjectContainer";
import { RunModelType } from "../../dbt_integration";
import { ProjectContext } from "../../projects/projectContext";
import { DeclaredProject } from "../../projects/projectRegistry";

const untitledUri = {
  scheme: "untitled",
  fsPath: "Untitled-1",
  path: "Untitled-1",
} as Uri;

describe("RunModel SQL execution", () => {
  let dbtProject: jest.Mocked<DBTProject>;
  let container: jest.Mocked<DBTProjectContainer>;
  let context: jest.Mocked<ProjectContext>;
  let runModel: RunModel;
  let project: DeclaredProject;

  beforeEach(() => {
    dbtProject = {
      executeSQLOnQueryPanel: jest.fn(),
    } as unknown as jest.Mocked<DBTProject>;
    container = {
      findDBTProject: jest.fn().mockReturnValue(dbtProject),
    } as unknown as jest.Mocked<DBTProjectContainer>;
    context = {
      requireForCommand: jest.fn(),
    } as unknown as jest.Mocked<ProjectContext>;
    project = {
      root: Uri.file("/project"),
      name: "project",
      folder: { uri: Uri.file("/workspace"), name: "workspace", index: 0 },
      contains: () => true,
      dispose: jest.fn(),
    };
    runModel = new RunModel(container, context);
  });

  afterEach(() => {
    (window.activeTextEditor as unknown) = undefined;
    jest.clearAllMocks();
  });

  it.each([Uri.file("/project/models/model.sql"), untitledUri])(
    "executes against the Project Context result for %s",
    async (uri) => {
      context.requireForCommand.mockResolvedValue(project);

      await runModel.executeSQL(uri, "select 1", "model");

      expect(context.requireForCommand).toHaveBeenCalledWith(uri);
      expect(container.findDBTProject).toHaveBeenCalledWith(project.root);
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
    container.findDBTProject.mockReturnValue(undefined);

    await runModel.executeSQL(untitledUri, "select 1", "model");

    expect(dbtProject.executeSQLOnQueryPanel).not.toHaveBeenCalled();
  });
});

describe("RunModel project commands", () => {
  const model = Uri.file("/project/models/orders.sql");
  let dbtProject: jest.Mocked<DBTProject>;
  let container: jest.Mocked<DBTProjectContainer>;
  let runModel: RunModel;

  beforeEach(() => {
    jest
      .spyOn(fs.realpathSync, "native")
      .mockImplementation((value) => value as string);
    dbtProject = {
      runModel: jest.fn(),
      buildModel: jest.fn(),
      compileModel: jest.fn(),
      compileQuery: jest.fn(),
      runTest: jest.fn(),
      runModelTest: jest.fn(),
      generateSchemaYML: jest.fn(),
      showRunSQL: jest.fn(),
    } as unknown as jest.Mocked<DBTProject>;
    container = {
      findDBTProject: jest.fn().mockReturnValue(dbtProject),
    } as unknown as jest.Mocked<DBTProjectContainer>;
    runModel = new RunModel(container, {} as ProjectContext);
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

    expect(dbtProject.runModel).toHaveBeenCalledWith({
      ...orders,
      plusOperatorLeft: "+",
    });
    expect(dbtProject.buildModel).toHaveBeenCalledWith({
      ...orders,
      plusOperatorRight: "+",
    });
    expect(dbtProject.compileModel).toHaveBeenCalledWith(orders);
  });

  it("delegates query, test, schema, and run-SQL operations", () => {
    runModel.compileDBTQuery(model, "select 1");
    runModel.runDBTTest(model, "unique_orders");
    runModel.runDBTModelTest(model);
    runModel.generateSchemaYML(model);
    runModel.showRunSQL(model);

    expect(container.findDBTProject).toHaveBeenCalledWith(model);
    expect(dbtProject.compileQuery).toHaveBeenCalledWith("select 1");
    expect(dbtProject.runTest).toHaveBeenCalledWith("unique_orders");
    expect(dbtProject.runModelTest).toHaveBeenCalledWith("orders");
    expect(dbtProject.generateSchemaYML).toHaveBeenCalledWith(model, "orders");
    expect(dbtProject.showRunSQL).toHaveBeenCalledWith(model);
  });

  it("does nothing outside any project", () => {
    container.findDBTProject.mockReturnValue(undefined);

    runModel.runDBTModel(model);
    runModel.buildDBTModel(model);
    runModel.compileDBTModel(model);
    runModel.showRunSQL(model);

    expect(dbtProject.runModel).not.toHaveBeenCalled();
    expect(dbtProject.buildModel).not.toHaveBeenCalled();
    expect(dbtProject.compileModel).not.toHaveBeenCalled();
    expect(dbtProject.showRunSQL).not.toHaveBeenCalled();
  });
});
