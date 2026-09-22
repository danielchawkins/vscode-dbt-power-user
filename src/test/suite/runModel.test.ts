import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { Uri, window } from "vscode";
import { RunModel } from "../../commands/runModel";
import { DBTProjectContainer } from "../../dbt_client/dbtProjectContainer";
import { ProjectContext } from "../../projects/projectContext";
import { DeclaredProject } from "../../projects/projectRegistry";

const untitledUri = {
  scheme: "untitled",
  fsPath: "Untitled-1",
  path: "Untitled-1",
} as Uri;

describe("RunModel SQL execution", () => {
  let container: jest.Mocked<DBTProjectContainer>;
  let context: jest.Mocked<ProjectContext>;
  let runModel: RunModel;
  let project: DeclaredProject;

  beforeEach(() => {
    container = {
      executeSQL: jest.fn(),
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
      expect(container.executeSQL).toHaveBeenCalledWith(
        project.root,
        "select 1",
        "model",
      );
    },
  );

  it("returns without execution when project selection is cancelled", async () => {
    context.requireForCommand.mockResolvedValue(undefined);

    await runModel.executeSQL(untitledUri, "select 1", "model");

    expect(container.executeSQL).not.toHaveBeenCalled();
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
    expect(container.executeSQL).not.toHaveBeenCalled();
    resolveProject(project);
    await execution;

    expect(container.executeSQL).toHaveBeenCalledWith(
      project.root,
      "select 1",
      "Untitled-1",
    );
  });
});
