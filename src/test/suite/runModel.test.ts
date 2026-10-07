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
import { RunModelType } from "../../dbt_integration/domain";
import { RunModel } from "../../features/run/runModel";
import { CurrentProject } from "../../projects/currentProject";
import { previewUriFor } from "../../projects/previewUri";
import { Project } from "../../projects/project";
import { DeclaredProject } from "../../projects/projectRegistry";
import { Projects } from "../../projects/projects";
import { RecordingTasks } from "../recordingTasks";

vi.mock("vscode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vscode")>()),
  Uri: (await import("vscode-uri")).URI,
}));

const untitledUri = {
  scheme: "untitled",
  fsPath: "Untitled-1",
  path: "Untitled-1",
} as Uri;

describe("RunModel SQL execution", () => {
  let executed: [string, string][];
  let dbtProject: Project;
  let projects: Mocked<Projects>;
  let context: Mocked<CurrentProject>;
  let runModel: RunModel;
  let project: DeclaredProject;

  beforeEach(() => {
    executed = [];
    dbtProject = {
      executeSQLOnQueryPanel: (query: string, modelName: string) => {
        executed.push([query, modelName]);
      },
    } as unknown as Project;
    project = {
      root: Uri.file("/project"),
      name: "project",
      folder: { uri: Uri.file("/workspace"), name: "workspace", index: 0 },
      contains: () => true,
      dispose: vi.fn(),
    };
    projects = {
      get: vi.fn((root: Uri) =>
        root === project.root ? dbtProject : undefined,
      ),
    } as unknown as Mocked<Projects>;
    context = {
      requireForCommand: vi.fn(),
    } as unknown as Mocked<CurrentProject>;
    runModel = new RunModel(projects, context);
  });

  afterEach(() => {
    (window.activeTextEditor as unknown) = undefined;
    vi.clearAllMocks();
  });

  it.each([Uri.file("/project/models/model.sql"), untitledUri])(
    "executes against the Current Project result for %s",
    async (uri) => {
      context.requireForCommand.mockImplementation((requested) =>
        Promise.resolve(requested === uri ? project : undefined),
      );

      await runModel.executeSQL(uri, "select 1", "model");

      expect(executed).toEqual([["select 1", "model"]]);
    },
  );

  it("returns without execution when project selection is cancelled", async () => {
    context.requireForCommand.mockResolvedValue(undefined);

    await runModel.executeSQL(untitledUri, "select 1", "model");

    expect(executed).toEqual([]);
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
    expect(executed).toEqual([]);
    resolveProject(project);
    await execution;

    expect(executed).toEqual([["select 1", "Untitled-1"]]);
  });

  it("tests the model an active compiled preview resolves to", () => {
    const tested: string[] = [];
    const model = Uri.file("/project/models/orders.sql");
    const preview = previewUriFor(model);
    projects.get.mockImplementation((uri: Uri) =>
      uri.fsPath === model.fsPath
        ? ({ runModelTest: (name: string) => tested.push(name) } as never)
        : undefined,
    );
    (window.activeTextEditor as unknown) = { document: { uri: preview } };

    runModel.runTestsOnActiveWindow();

    expect(tested).toEqual(["orders"]);
  });

  it("does nothing when no project owns the resolved root", async () => {
    context.requireForCommand.mockResolvedValue(project);
    projects.get.mockReturnValue(undefined);

    await runModel.executeSQL(untitledUri, "select 1", "model");

    expect(executed).toEqual([]);
  });
});

describe("RunModel project commands", () => {
  const model = Uri.file("/project/models/orders.sql");
  let tasks: RecordingTasks;
  let other: string[];
  let owned: boolean;
  let runModel: RunModel;

  beforeEach(() => {
    vi.spyOn(fs.realpathSync, "native").mockImplementation(
      (value) => value as string,
    );
    tasks = new RecordingTasks();
    other = [];
    owned = true;
    const project = {
      runModel: (params) => tasks.runModel(params),
      buildModel: (params) => tasks.buildModel(params),
      compileModel: (params) => tasks.compileModel(params),
      runTest: (name) => tasks.runTest(name),
      runModelTest: (name) => tasks.runModelTest(name),
      compileQuery: (query, uri) => other.push(`compileQuery ${query} ${uri}`),
      generateSchemaYML: (uri, name) =>
        other.push(`generateSchemaYML ${uri} ${name}`),
      showRunSQL: (uri) => other.push(`showRunSQL ${uri}`),
    } as Record<string, (...args: never[]) => unknown>;
    const projects = {
      get: (uri: Uri) => (owned && uri === model ? project : undefined),
    } as unknown as Projects;
    runModel = new RunModel(projects, {} as CurrentProject);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds run, build, and compile commands selecting the model with graph operators", () => {
    runModel.runDBTModel(model, RunModelType.RUN_PARENTS);
    runModel.buildDBTModel(model, RunModelType.BUILD_CHILDREN);
    runModel.compileDBTModel(model);

    expect(tasks.commands).toEqual([
      { kind: "run", select: "+orders" },
      { kind: "build", select: "orders+" },
      { kind: "compile", select: "orders" },
    ]);
  });

  it("builds test commands and delegates query, schema, and run-SQL operations", () => {
    runModel.compileDBTQuery(model, "select 1");
    runModel.runDBTTest(model, "unique_orders");
    runModel.runDBTModelTest(model);
    runModel.generateSchemaYML(model);
    runModel.showRunSQL(model);

    expect(tasks.commands).toEqual([
      { kind: "test", select: "unique_orders" },
      { kind: "test", select: "orders" },
    ]);
    expect(other).toEqual([
      `compileQuery select 1 ${model}`,
      `generateSchemaYML ${model} orders`,
      `showRunSQL ${model}`,
    ]);
  });

  it("does nothing outside any project", () => {
    owned = false;

    runModel.runDBTModel(model);
    runModel.buildDBTModel(model);
    runModel.compileDBTModel(model);
    runModel.showRunSQL(model);

    expect(tasks.commands).toEqual([]);
    expect(other).toEqual([]);
  });
});
