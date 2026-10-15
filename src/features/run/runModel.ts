import * as path from "node:path";
import type { TreeItem } from "vscode";
import { Uri, window } from "vscode";
import { RunModelType } from "../../core/dbt/domain";
import { notifyErrorWithoutProject } from "../../projects/output/notifications";
import type { CurrentProject } from "../../projects/project/currentProject";
import type { GenerateModelFromSourceParams } from "../../projects/project/projectCodegen";
import { modelParamsFor } from "../../projects/project/projectCommands";
import type { ProjectDbtCommands } from "../../projects/project/projectDbtCommands";
import type { ProjectQueries } from "../../projects/project/projectQueries";
import type { ProjectLookup } from "../../projects/project/projects";

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
};
import { activeModelUri } from "../../projects/registry/previewUri";

/** The model tree item fields a run reads. */
type NodeTreeItem = Pick<TreeItem, "label"> & { url: string | undefined };

const labelText = (label: NonNullable<TreeItem["label"]>): string =>
  typeof label === "string" ? label : label.label;

export class RunModel {
  private projects: ProjectLookup<ModelProject>;
  private currentProject: CurrentProject;

  constructor(
    projects: ProjectLookup<ModelProject>,
    currentProject: CurrentProject,
  ) {
    this.projects = projects;
    this.currentProject = currentProject;
  }

  runModelOnActiveWindow(type?: RunModelType) {
    if (!window.activeTextEditor) {
      return;
    }
    const fullPath = activeModelUri(window.activeTextEditor.document.uri);
    this.runDBTModel(fullPath, type);
  }

  buildModelOnActiveWindow(type?: RunModelType) {
    if (!window.activeTextEditor) {
      return;
    }
    const fullPath = activeModelUri(window.activeTextEditor.document.uri);
    this.buildDBTModel(fullPath, type);
  }

  runTestsOnActiveWindow() {
    if (!window.activeTextEditor) {
      return;
    }
    const fullPath = activeModelUri(window.activeTextEditor.document.uri);
    this.runDBTModelTest(fullPath);
  }

  compileModelOnActiveWindow() {
    if (!window.activeTextEditor) {
      return;
    }
    const fullPath = activeModelUri(window.activeTextEditor.document.uri);
    this.compileDBTModel(fullPath);
  }

  compileQueryOnActiveWindow() {
    if (!window.activeTextEditor) {
      return;
    }
    const fullPath = activeModelUri(window.activeTextEditor.document.uri);
    const query = window.activeTextEditor.document.getText();
    if (query !== undefined) {
      this.compileDBTQuery(fullPath, query);
    }
  }

  private getQuery() {
    if (!window.activeTextEditor) {
      return;
    }
    const cursor = window.activeTextEditor.selection;
    return window.activeTextEditor.document.getText(
      cursor.isEmpty ? undefined : cursor,
    );
  }

  async executeQueryOnActiveWindow(): Promise<void> {
    const query = this.getQuery();
    if (query === undefined) {
      return;
    }
    const activeUri = window.activeTextEditor?.document.uri;
    if (activeUri) {
      const modelPath = activeModelUri(activeUri);
      const modelName = path.basename(modelPath.fsPath, ".sql");
      await this.executeSQL(modelPath, query, modelName);
    }
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
    const activeUri = window.activeTextEditor?.document.uri;
    if (activeUri !== undefined) {
      const fullPath = activeModelUri(activeUri);
      this.generateSchemaYML(fullPath);
    }
  }
  showRunSQLOnActiveWindow() {
    const activeUri = window.activeTextEditor?.document.uri;
    if (activeUri !== undefined) {
      const fullPath = activeModelUri(activeUri);
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

  async executeSQL(uri: Uri, query: string, modelName: string) {
    const declared = await this.currentProject.requireForCommand(uri);
    if (!declared) {
      return;
    }
    const project = this.projects.get(declared.root);
    if (!project) {
      return;
    }
    void project.queries.executeSQLOnQueryPanel(query, modelName);
  }

  generateSchemaYML(modelPath: Uri) {
    const project = this.projects.get(modelPath);
    if (!project) {
      return;
    }
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
