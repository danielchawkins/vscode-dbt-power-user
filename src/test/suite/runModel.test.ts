import type { queryResults } from "@fusion-power-user/webview-contract";
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
import { Uri, window, workspace } from "vscode";
import type { RunModelParams } from "../../core/dbt/domain";
import { RunModelType } from "../../core/dbt/domain";
import type { NodeMetaData } from "../../core/manifest/types";
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
  let executed: {
    query: string;
    modelName: string;
    preview?: queryResults.ModelPreview | undefined;
  }[];
  let dbtProject: Project;
  let projects: { get: Mock; ensureFresh: Mock };
  let context: Mocked<CurrentProject>;
  let runModel: RunModel;
  let project: DeclaredProject;

  /** A project whose manifest records `nodes`, looked up by base name and resource type as the real map is. */
  const projectWithNodes = (nodes: Partial<NodeMetaData>[]) => ({
    queries: dbtProject.queries,
    manifest: {
      nodeMetaMap: {
        lookupByBaseName: (name: string, type?: string) =>
          nodes.find(
            (node) =>
              node.name === name &&
              (type === undefined || node.resource_type === type),
          ) as NodeMetaData | undefined,
      },
    },
    projectRoot: Uri.file("/project"),
  });

  beforeEach(() => {
    // Paths resolve to themselves unless a test maps an alias, so no case reads the real filesystem.
    vi.spyOn(fs.realpathSync, "native").mockImplementation(
      (value) => value as string,
    );
    executed = [];
    dbtProject = {
      queries: {
        executeSQLOnQueryPanel: (
          query: string,
          modelName: string,
          preview?: queryResults.ModelPreview,
        ) => {
          executed.push({ query, modelName, preview });
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
      ensureFresh: vi.fn().mockResolvedValue(undefined),
    };
    context = {
      requireForCommand: vi.fn(),
    } as unknown as Mocked<CurrentProject>;
    runModel = new RunModel(projects, context);
  });

  afterEach(() => {
    (window.activeTextEditor as unknown) = undefined;
    vi.restoreAllMocks();
  });

  it.each([Uri.file("/project/models/model.sql")])(
    "executes against the Current Project result for %s",
    async (uri) => {
      context.requireForCommand.mockImplementation((requested) =>
        Promise.resolve(requested === uri ? project : undefined),
      );

      await runModel.executeSQL(uri, "select 1", { modelName: "model" });

      expect(executed).toEqual([{ query: "select 1", modelName: "model" }]);
    },
  );

  it("returns without execution when project selection is cancelled", async () => {
    context.requireForCommand.mockResolvedValue(undefined);

    await runModel.executeSQL(untitledUri, "select 1", { modelName: "model" });

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

    expect(executed).toEqual([{ query: "select 1", modelName: "Untitled-1" }]);
    expect(executed[0]?.preview).toBeUndefined();
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

  it("previews a whole model file computed, and a selection with no preview", async () => {
    const model = Uri.file("/project/models/orders.sql");
    projects.get.mockReturnValue(
      projectWithNodes([
        { name: "orders", resource_type: "model", path: model.fsPath },
      ]),
    );
    context.requireForCommand.mockResolvedValue(project);
    (window.activeTextEditor as unknown) = {
      document: { uri: model, getText: () => "select 1" },
      selection: { isEmpty: true },
    };
    await runModel.executeQueryOnActiveWindow();
    expect(executed).toEqual([
      {
        query: "select 1",
        modelName: "orders",
        preview: { mode: "computed", model: model.fsPath },
      },
    ]);

    executed = [];
    (window.activeTextEditor as unknown) = {
      document: { uri: model, getText: () => "select 2" },
      selection: { isEmpty: false },
    };
    await runModel.executeQueryOnActiveWindow();
    expect(executed).toEqual([{ query: "select 2", modelName: "orders" }]);
    expect(executed[0]?.preview).toBeUndefined();
  });

  it.each([
    ["a model", "/project/models/orders.sql", true],
    ["an analysis named like a model", "/project/analyses/orders.sql", false],
    [
      "a compiled model under target/",
      "/project/target/compiled/jaffle/models/orders.sql",
      false,
    ],
  ])(
    "previews %s computed only when the manifest records that file as a model",
    async (_kind, filePath, previewed) => {
      projects.get.mockReturnValue(
        projectWithNodes([
          {
            name: "orders",
            resource_type: "model",
            path: "/project/models/orders.sql",
          },
        ]),
      );
      context.requireForCommand.mockResolvedValue(project);
      (window.activeTextEditor as unknown) = {
        document: { uri: Uri.file(filePath), getText: () => "select 1" },
        selection: { isEmpty: true },
      };

      await runModel.executeQueryOnActiveWindow();

      expect(executed).toHaveLength(1);
      expect(executed[0]?.preview).toEqual(
        previewed ? { mode: "computed", model: filePath } : undefined,
      );
    },
  );

  it.each([
    ["the file under the project root", "/project/models/orders.sql", true],
    ["a file of the same name elsewhere", "/elsewhere/orders.sql", false],
  ])(
    "previews computed by original_file_path when the node has no path, for %s",
    async (_kind, filePath, previewed) => {
      projects.get.mockReturnValue(
        projectWithNodes([
          {
            name: "orders",
            resource_type: "model",
            original_file_path: "models/orders.sql",
          },
        ]),
      );
      context.requireForCommand.mockResolvedValue(project);
      (window.activeTextEditor as unknown) = {
        document: { uri: Uri.file(filePath), getText: () => "select 1" },
        selection: { isEmpty: true },
      };

      await runModel.executeQueryOnActiveWindow();

      expect(executed).toHaveLength(1);
      expect(executed[0]?.preview).toEqual(
        previewed ? { mode: "computed", model: filePath } : undefined,
      );
    },
  );

  it("previews computed a node with neither path nor original_file_path as the file", async () => {
    const model = Uri.file("/project/models/orders.sql");
    projects.get.mockReturnValue(
      projectWithNodes([{ name: "orders", resource_type: "model" }]),
    );
    context.requireForCommand.mockResolvedValue(project);
    (window.activeTextEditor as unknown) = {
      document: { uri: model, getText: () => "select 1" },
      selection: { isEmpty: true },
    };

    await runModel.executeQueryOnActiveWindow();

    expect(executed).toEqual([
      {
        query: "select 1",
        modelName: "orders",
        preview: { mode: "computed", model: model.fsPath },
      },
    ]);
  });

  it("previews a model opened through an alias that resolves to the node's path", async () => {
    const alias = "/alias/models/orders.sql";
    vi.spyOn(fs.realpathSync, "native").mockImplementation((value) =>
      value === alias ? "/project/models/orders.sql" : (value as string),
    );
    projects.get.mockReturnValue(
      projectWithNodes([
        {
          name: "orders",
          resource_type: "model",
          path: "/project/models/orders.sql",
        },
      ]),
    );
    context.requireForCommand.mockResolvedValue(project);
    (window.activeTextEditor as unknown) = {
      document: { uri: Uri.file(alias), getText: () => "select 1" },
      selection: { isEmpty: true },
    };

    await runModel.executeQueryOnActiveWindow();

    expect(executed).toEqual([
      {
        query: "select 1",
        modelName: "orders",
        preview: { mode: "computed", model: alias },
      },
    ]);
  });

  it("previews a model's computed SQL from its open document, unsaved edits included", async () => {
    const model = Uri.file("/project/models/orders.sql");
    context.requireForCommand.mockResolvedValue(project);
    vi.mocked(workspace.openTextDocument).mockResolvedValue({
      getText: () => "select edited",
    } as never);

    await runModel.previewComputed({ label: "orders", url: model.fsPath });

    expect(workspace.openTextDocument).toHaveBeenCalledWith(model);
    expect(executed).toEqual([
      {
        query: "select edited",
        modelName: "orders",
        preview: { mode: "computed", model: model.fsPath },
      },
    ]);
  });

  it("does nothing when no project owns the resolved root", async () => {
    context.requireForCommand.mockResolvedValue(project);
    projects.get.mockReturnValue(undefined);

    await runModel.executeSQL(untitledUri, "select 1", { modelName: "model" });

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
      {
        query: "select * from {{ ref('jaffle', 'orders') }}",
        modelName: "orders (materialized)",
        preview: { mode: "materialized", model: model.fsPath },
      },
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
    vi.mocked(workspace.openTextDocument).mockResolvedValue({
      getText: () => "select 1",
    } as never);
    await runModel.previewMaterialized({ label: "orders", url: model.fsPath });
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      "orders is ephemeral, so it has no table to preview.",
      "Execute dbt SQL",
    );
  });

  it("runs the ephemeral model's computed preview, not the active editor's SQL", async () => {
    const model = Uri.file("/project/models/ephemeral_orders.sql");
    const other = Uri.file("/project/models/other.sql");
    projects.get.mockReturnValue(
      projectWithNodes([
        {
          name: "ephemeral_orders",
          resource_type: "model",
          path: model.fsPath,
          config: { materialized: "ephemeral" },
        },
      ]),
    );
    context.requireForCommand.mockResolvedValue(project);
    vi.mocked(window.showInformationMessage).mockResolvedValue(
      "Execute dbt SQL" as never,
    );
    vi.mocked(workspace.openTextDocument).mockResolvedValue({
      getText: () => "select ephemeral",
    } as never);
    (window.activeTextEditor as unknown) = {
      document: { uri: other, getText: () => "select other" },
      selection: { isEmpty: true },
    };

    await runModel.previewMaterialized({
      label: "ephemeral_orders",
      url: model.fsPath,
    });

    expect(workspace.openTextDocument).toHaveBeenCalledWith(model);
    expect(executed).toEqual([
      {
        query: "select ephemeral",
        modelName: "ephemeral_orders",
        preview: { mode: "computed", model: model.fsPath },
      },
    ]);
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
      ensureFresh: async () => undefined,
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

  it("builds test commands and delegates query, schema, and run-SQL operations", async () => {
    runModel.compileDBTQuery(model, "select 1");
    runModel.runDBTTest(model, "unique_orders");
    runModel.runDBTModelTest(model);
    await runModel.generateSchemaYML(model);
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
