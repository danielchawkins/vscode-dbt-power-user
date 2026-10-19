import * as fs from "node:fs";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  type Mocked,
  vi,
} from "vitest";
import type * as vscodeApi from "vscode";
import { Uri, window } from "vscode";
import type { RunModelParams } from "../../core/dbt/domain";
import { RunModelType } from "../../core/dbt/domain";
import { RunModel } from "../../features/run/runModel";
import type { CurrentProject } from "../../projects/project/currentProject";
import type { Project } from "../../projects/project/project";
import { previewUriFor } from "../../projects/registry/previewUri";
import type { DeclaredProject } from "../../projects/registry/projectRegistry";
import { RecordingTasks } from "../recordingTasks";

vi.mock("vscode", async (importOriginal) => ({
  ...(await importOriginal<typeof vscodeApi>()),
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
  let projects: { get: Mock };
  let context: Mocked<CurrentProject>;
  let runModel: RunModel;
  let project: DeclaredProject;

  beforeEach(() => {
    executed = [];
    dbtProject = {
      queries: {
        executeSQLOnQueryPanel: (query: string, modelName: string) => {
          executed.push([query, modelName]);
        },
      },
    } as unknown as Project;
    project = {
      root: Uri.file("/project"),
      name: "project",
      folder: { uri: Uri.file("/workspace"), name: "workspace", index: 0 },
      origin: "explicit",
      contains: () => true,
      dispose: vi.fn(),
    };
    projects = {
      get: vi.fn((root: Uri) =>
        root === project.root ? dbtProject : undefined,
      ),
    };
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
        ? ({
            commands: { runModelTest: (name: string) => tested.push(name) },
          } as never)
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

  it("previews the active model's materialized relation, and offers the SQL preview for an ephemeral one", async () => {
    const model = Uri.file("/project/models/orders.sql");
    let materialized = "table";
    projects.get.mockImplementation((uri: Uri) =>
      uri.fsPath === model.fsPath
        ? {
            queries: dbtProject.queries,
            manifest: {
              nodeMetaMap: {
                lookupByBaseName: () => ({
                  name: "orders",
                  package_name: "jaffle",
                  config: { materialized },
                }),
              },
            },
          }
        : undefined,
    );
    (window.activeTextEditor as unknown) = {
      document: { uri: model, getText: () => "select 1" },
      selection: { isEmpty: true },
    };

    await runModel.previewMaterialized();
    expect(executed).toEqual([
      ["select * from {{ ref('jaffle', 'orders') }}", "orders (materialized)"],
    ]);

    // A model tree item names its file, so the preview needs no open editor.
    (window.activeTextEditor as unknown) = undefined;
    await runModel.previewMaterialized({ label: "orders", url: model.fsPath });
    expect(executed).toHaveLength(2);

    materialized = "ephemeral";
    vi.mocked(window.showInformationMessage).mockResolvedValue(
      "Execute dbt SQL" as never,
    );
    context.requireForCommand.mockResolvedValue(project);
    projects.get.mockClear();
    await runModel.previewMaterialized({ label: "orders", url: model.fsPath });
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      "orders is ephemeral, so it has no table to preview.",
      "Execute dbt SQL",
    );
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
      commands: {
        runModel: (params: RunModelParams) => tasks.runModel(params),
        buildModel: (params: RunModelParams) => tasks.buildModel(params),
        compileModel: (params: RunModelParams) => tasks.compileModel(params),
        runTest: (name: string) => tasks.runTest(name),
        runModelTest: (name: string) => tasks.runModelTest(name),
      },
      queries: {
        compileQuery: async (query: string, uri?: Uri) => {
          other.push(`compileQuery ${query} ${uri}`);
          return undefined;
        },
        generateSchemaYML: async (uri: Uri, name: string) => {
          other.push(`generateSchemaYML ${uri} ${name}`);
        },
        showRunSQL: (uri: Uri) => {
          other.push(`showRunSQL ${uri}`);
        },
        executeSQLOnQueryPanel: async (query: string, modelName: string) => {
          other.push(`executeSQLOnQueryPanel ${query} ${modelName}`);
        },
        generateModel: async (
          name: string,
          table: string,
          sourcePath: string,
        ) => {
          other.push(`generateModel ${name} ${table} ${sourcePath}`);
        },
      },
    };
    const projects = {
      get: (uri: Uri) => (owned && uri === model ? project : undefined),
    };
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
