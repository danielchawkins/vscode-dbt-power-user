import * as fs from "fs";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mocked,
  vi,
} from "vitest";
import { Uri, window } from "vscode";
import { RunModelType } from "../../dbt_integration";
import { RunModel } from "../../features/run/runModel";
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
  let dbtProject: Mocked<Project>;
  let projects: Mocked<Projects>;
  let context: Mocked<CurrentProject>;
  let runModel: RunModel;
  let project: DeclaredProject;

  beforeEach(() => {
    dbtProject = {
      executeSQLOnQueryPanel: vi.fn(),
    } as unknown as Mocked<Project>;
    projects = {
      get: vi.fn().mockReturnValue(dbtProject),
    } as unknown as Mocked<Projects>;
    context = {
      requireForCommand: vi.fn(),
    } as unknown as Mocked<CurrentProject>;
    project = {
      root: Uri.file("/project"),
      name: "project",
      folder: { uri: Uri.file("/workspace"), name: "workspace", index: 0 },
      contains: () => true,
      dispose: vi.fn(),
    };
    runModel = new RunModel(projects, context);
  });

  afterEach(() => {
    (window.activeTextEditor as unknown) = undefined;
    vi.clearAllMocks();
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
        getText: vi.fn().mockReturnValue("select 1"),
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
  let project: Mocked<Project>;
  let projects: Mocked<Projects>;
  let runModel: RunModel;

  beforeEach(() => {
    vi.spyOn(fs.realpathSync, "native").mockImplementation(
      (value) => value as string,
    );
    project = {
      runModel: vi.fn(),
      buildModel: vi.fn(),
      compileModel: vi.fn(),
      compileQuery: vi.fn(),
      runTest: vi.fn(),
      runModelTest: vi.fn(),
      generateSchemaYML: vi.fn(),
      showRunSQL: vi.fn(),
    } as unknown as Mocked<Project>;
    projects = {
      get: vi.fn().mockReturnValue(project),
    } as unknown as Mocked<Projects>;
    runModel = new RunModel(projects, {} as CurrentProject);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
