import type { queryResults } from "@fusion-power-user/webview-contract";
import * as path from "node:path";
import type { TextEditor, TreeItem } from "vscode";
import { ProgressLocation, Uri, window, workspace } from "vscode";
import { RunModelType } from "../../core/dbt/domain";
import type { NodeMetaData } from "../../core/manifest/types";
import type { Manifest } from "../../projects/manifest/manifestTypes";
import { notifyErrorWithoutProject } from "../../projects/output/notifications";
import type { CurrentProject } from "../../projects/project/currentProject";
import type { GenerateModelFromSourceParams } from "../../projects/project/projectCodegen";
import { modelParamsFor } from "../../projects/project/projectCommands";
import type { ProjectDbtCommands } from "../../projects/project/projectDbtCommands";
import type { ProjectQueries } from "../../projects/project/projectQueries";
import type { ProjectLookup, Projects } from "../../projects/project/projects";

/** What running, compiling and generating a model read from its project. */
type ModelProject = {
  commands: Pick<
    ProjectDbtCommands,
    "runModel" | "buildModel" | "compileModel" | "runTest" | "runModelTest"
  >;
  queries: Pick<
    ProjectQueries,
    | "compileQuery"
    | "executeSQLOnQueryPanel"
    | "generateModel"
    | "generateSchemaYML"
    | "showRunSQL"
  >;
  /** The manifest the materialized preview reads a model's package and materialization from. */
  manifest?: Pick<Manifest, "nodeMetaMap"> | undefined;
  /** The root the manifest's `original_file_path`s are relative to, when the project has one. */
  root?: Uri | undefined;
};
import { activeModelUri } from "../../projects/registry/previewUri";
import { canonicalPath } from "../../projects/registry/projectRegistry";
import { materializedPreview } from "./materializedPreview";

/** The model tree item fields a run reads. */
type NodeTreeItem = Pick<TreeItem, "label"> & { url: string | undefined };

/** Where a query's result goes: the model it reports as, and the model preview it shows, if any. */
type QueryTarget = {
  modelName: string;
  preview?: queryResults.ModelPreview | undefined;
};

/**
 * Whether manifest `node` is the file at `filePath`: by its own path when the manifest has one, else by its
 * file relative to the project root. Paths are compared by realpath, so an alias of the file is the same file.
 * With neither to compare, the node is taken as the file.
 */
const isNodeFile = (
  node: NodeMetaData,
  filePath: string,
  projectRoot: Uri | undefined,
): boolean => {
  const file = canonicalPath(filePath);
  if (node.path !== undefined) {
    return canonicalPath(node.path) === file;
  }
  if (node.original_file_path !== undefined && projectRoot !== undefined) {
    const nodePath = path.join(projectRoot.fsPath, node.original_file_path);
    return canonicalPath(nodePath) === file;
  }
  return true;
};

/**
 * Whether the editor shows a whole model file on disk: no selection, a `.sql` file (not untitled, nor a compiled
 * preview), and a model of `project` that is that file. Analyses, tests, macros and `target/` files are not.
 */
const isWholeModelFile = (
  editor: TextEditor | undefined,
  project: ModelProject | undefined,
): boolean => {
  if (
    editor === undefined ||
    !editor.selection.isEmpty ||
    editor.document.uri.scheme !== "file" ||
    !editor.document.uri.fsPath.endsWith(".sql")
  ) {
    return false;
  }
  const filePath = editor.document.uri.fsPath;
  const node = project?.manifest?.nodeMetaMap.lookupByBaseName(
    path.basename(filePath, ".sql"),
    "model",
  );
  return node !== undefined && isNodeFile(node, filePath, project?.root);
};

const labelText = (label: NonNullable<TreeItem["label"]>): string =>
  typeof label === "string" ? label : label.label;

const EXECUTE_SQL = "Execute dbt SQL";

/** The model projects, which also bring a project's manifest up to date before a codegen read. */
type ModelLookup = ProjectLookup<ModelProject> & Pick<Projects, "ensureFresh">;

export class RunModel {
  private projects: ModelLookup;
  private currentProject: CurrentProject;

  constructor(projects: ModelLookup, currentProject: CurrentProject) {
    this.projects = projects;
    this.currentProject = currentProject;
  }

  /** The model the active editor stands for; `undefined` when no editor is active. */
  private activeModel(): Uri | undefined {
    return this.currentProject.activeEditor()?.modelUri;
  }

  runModelOnActiveWindow(type?: RunModelType) {
    const fullPath = this.activeModel();
    if (!fullPath) {
      return;
    }
    this.runDBTModel(fullPath, type);
  }

  buildModelOnActiveWindow(type?: RunModelType) {
    const fullPath = this.activeModel();
    if (!fullPath) {
      return;
    }
    this.buildDBTModel(fullPath, type);
  }

  runTestsOnActiveWindow() {
    const fullPath = this.activeModel();
    if (!fullPath) {
      return;
    }
    this.runDBTModelTest(fullPath);
  }

  compileModelOnActiveWindow() {
    const fullPath = this.activeModel();
    if (!fullPath) {
      return;
    }
    this.compileDBTModel(fullPath);
  }

  compileQueryOnActiveWindow() {
    const active = this.currentProject.activeEditor();
    if (!active) {
      return;
    }
    const query = active.editor.document.getText();
    if (query !== undefined) {
      this.compileDBTQuery(active.modelUri, query);
    }
  }

  private getQuery() {
    const active = this.currentProject.activeEditor();
    if (!active) {
      return;
    }
    const cursor = active.editor.selection;
    return active.editor.document.getText(cursor.isEmpty ? undefined : cursor);
  }

  async executeQueryOnActiveWindow(): Promise<void> {
    const query = this.getQuery();
    if (query === undefined) {
      return;
    }
    const active = this.currentProject.activeEditor();
    if (active) {
      const modelPath = active.modelUri;
      const modelName = path.basename(modelPath.fsPath, ".sql");
      const wholeModel = isWholeModelFile(
        active.editor,
        this.projects.get(modelPath),
      );
      await this.executeSQL(modelPath, query, {
        modelName,
        preview: wholeModel
          ? { mode: "computed", model: modelPath.fsPath }
          : undefined,
      });
    }
  }

  /** Previews what a model's SQL computes now, read from its open document or from disk. */
  async previewComputed(model: NodeTreeItem): Promise<void> {
    if (!model.url) {
      return;
    }
    const modelUri = Uri.file(model.url);
    // Returns the open document, unsaved edits included, when the model is open.
    const document = await workspace.openTextDocument(modelUri);
    await this.executeSQL(modelUri, document.getText(), {
      modelName: path.basename(modelUri.fsPath, ".sql"),
      preview: { mode: "computed", model: modelUri.fsPath },
    });
  }

  /** Previews what a model's relation holds now: the tree item's model, else the active editor's. */
  async previewMaterialized(model?: NodeTreeItem): Promise<void> {
    const modelPath = model?.url
      ? activeModelUri(Uri.file(model.url))
      : this.activeModel();
    if (!modelPath) {
      return;
    }
    const project = this.projects.get(modelPath);
    if (!project) {
      return;
    }
    const name = path.basename(modelPath.fsPath, ".sql");
    const preview = materializedPreview(
      name,
      project.manifest?.nodeMetaMap.lookupByBaseName(name, "model"),
    );
    if (preview.kind === "ephemeral") {
      const action = await window.showInformationMessage(
        `${name} is ephemeral, so it has no table to preview.`,
        EXECUTE_SQL,
      );
      if (action === EXECUTE_SQL) {
        await this.previewComputed({ url: modelPath.fsPath });
      }
      return;
    }
    await project.queries.executeSQLOnQueryPanel(preview.query, preview.label, {
      mode: "materialized",
      model: modelPath.fsPath,
    });
  }

  runModelOnNodeTreeItem(type: RunModelType) {
    return (model?: NodeTreeItem) => {
      if (model === undefined) {
        this.runModelOnActiveWindow(type);
        return;
      }
      if (!model.url) {
        return;
      }
      switch (type) {
        case RunModelType.TEST: {
          if (model.label) {
            this.runDBTTest(
              Uri.file(model.url),
              labelText(model.label).split(".")[0] ?? "",
            );
          }
          break;
        }
        case RunModelType.BUILD_CHILDREN:
        case RunModelType.BUILD_CHILDREN_PARENTS:
        case RunModelType.BUILD_PARENTS: {
          // Catch Parents || Children RunTypes
          this.buildDBTModel(Uri.file(model.url), type);
          break;
        }
        case RunModelType.RUN_CHILDREN:
        case RunModelType.RUN_PARENTS: {
          // Catch Parents || Children RunTypes
          this.runDBTModel(Uri.file(model.url), type);
          break;
        }
      }
    };
  }

  generateSchemaYMLOnActiveWindow() {
    const fullPath = this.activeModel();
    if (fullPath !== undefined) {
      void this.generateSchemaYML(fullPath);
    }
  }
  showRunSQLOnActiveWindow() {
    const fullPath = this.activeModel();
    if (fullPath !== undefined) {
      this.showRunSQL(fullPath);
    }
  }

  runDBTModel(modelPath: Uri, type?: RunModelType) {
    const project = this.projects.get(modelPath);
    if (!project) {
      return;
    }
    void project.commands.runModel(modelParamsFor(modelPath, type));
  }

  buildDBTModel(modelPath: Uri, type?: RunModelType) {
    const project = this.projects.get(modelPath);
    if (!project) {
      return;
    }
    void project.commands.buildModel(modelParamsFor(modelPath, type));
  }

  compileDBTModel(modelPath: Uri, type?: RunModelType) {
    const project = this.projects.get(modelPath);
    if (!project) {
      return;
    }
    void project.commands.compileModel(modelParamsFor(modelPath, type));
  }

  compileDBTQuery(modelPath: Uri, query: string) {
    const project = this.projects.get(modelPath);
    if (!project) {
      return;
    }
    void project.queries.compileQuery(query, modelPath);
  }

  runDBTTest(modelPath: Uri, testName: string) {
    const project = this.projects.get(modelPath);
    if (!project) {
      return;
    }
    void project.commands.runTest(testName);
  }

  runDBTModelTest(modelPath: Uri) {
    const project = this.projects.get(modelPath);
    if (!project) {
      return;
    }
    void project.commands.runModelTest(path.basename(modelPath.fsPath, ".sql"));
  }

  async executeSQL(uri: Uri, query: string, target: QueryTarget) {
    const project = await this.currentProject.requireForCommand(uri);
    if (!project) {
      return;
    }
    void project.queries.executeSQLOnQueryPanel(
      query,
      target.modelName,
      target.preview,
    );
  }

  async generateSchemaYML(modelPath: Uri) {
    const project = this.projects.get(modelPath);
    if (!project) {
      return;
    }
    await window.withProgress(
      {
        location: ProgressLocation.Window,
        title: "Updating project metadata…",
      },
      () => this.projects.ensureFresh(modelPath),
    );
    void project.queries.generateSchemaYML(
      modelPath,
      path.basename(modelPath.fsPath, ".sql"),
    );
  }

  showRunSQL(modelPath: Uri) {
    const project = this.projects.get(modelPath);
    if (!project) {
      return;
    }
    project.queries.showRunSQL(modelPath);
  }

  createModelBasedonSourceConfig(params: GenerateModelFromSourceParams) {
    const project = this.projects.get(params.currentDoc);
    const sourcePath = path.dirname(params.currentDoc.fsPath);
    if (project) {
      void project.queries.generateModel(
        params.sourceName,
        params.tableName,
        sourcePath,
      );
    } else {
      void notifyErrorWithoutProject(
        `Could not generate model: no project found for ${params.currentDoc.fsPath}`,
      );
    }
  }
}
