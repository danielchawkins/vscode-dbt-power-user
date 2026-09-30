import * as path from "path";
import { Uri, window } from "vscode";
import { GenerateModelFromSourceParams } from "../code_lens_provider/sourceModelCreationCodeLensProvider";
import { RunModelType } from "../dbt_integration";
import { modelParamsFor } from "../projects/projectCommands";
import { ProjectContext } from "../projects/projectContext";
import { Projects } from "../projects/projects";
import { NodeTreeItem } from "../treeview_provider/modelTreeviewProvider";
export class RunModel {
  constructor(
    private projects: Projects,
    private projectContext: ProjectContext,
  ) {}

  runModelOnActiveWindow(type?: RunModelType) {
    if (!window.activeTextEditor) {
      return;
    }
    const fullPath = window.activeTextEditor.document.uri;
    this.runDBTModel(fullPath, type);
  }

  buildModelOnActiveWindow(type?: RunModelType) {
    if (!window.activeTextEditor) {
      return;
    }
    const fullPath = window.activeTextEditor.document.uri;
    this.buildDBTModel(fullPath, type);
  }

  runTestsOnActiveWindow() {
    if (!window.activeTextEditor) {
      return;
    }
    const fullPath = window.activeTextEditor.document.uri;
    this.runDBTModelTest(fullPath);
  }

  compileModelOnActiveWindow() {
    if (!window.activeTextEditor) {
      return;
    }
    const fullPath = window.activeTextEditor.document.uri;
    this.compileDBTModel(fullPath);
  }

  compileQueryOnActiveWindow() {
    if (!window.activeTextEditor) {
      return;
    }
    const fullPath = window.activeTextEditor.document.uri;
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
    const modelPath = window.activeTextEditor?.document.uri;
    if (modelPath) {
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
              model.label.toString().split(".")[0],
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
    const fullPath = window.activeTextEditor?.document.uri;
    if (fullPath !== undefined) {
      this.generateSchemaYML(fullPath);
    }
  }
  showRunSQLOnActiveWindow() {
    const fullPath = window.activeTextEditor?.document.uri;
    if (fullPath !== undefined) {
      this.showRunSQL(fullPath);
    }
  }

  runDBTModel(modelPath: Uri, type?: RunModelType) {
    const project = this.projects.get(modelPath);
    if (!project) {
      return;
    }
    void project.runModel(modelParamsFor(modelPath, type));
  }

  buildDBTModel(modelPath: Uri, type?: RunModelType) {
    const project = this.projects.get(modelPath);
    if (!project) {
      return;
    }
    void project.buildModel(modelParamsFor(modelPath, type));
  }

  compileDBTModel(modelPath: Uri, type?: RunModelType) {
    const project = this.projects.get(modelPath);
    if (!project) {
      return;
    }
    void project.compileModel(modelParamsFor(modelPath, type));
  }

  compileDBTQuery(modelPath: Uri, query: string) {
    const project = this.projects.get(modelPath);
    if (!project) {
      return;
    }
    void project.compileQuery(query);
  }

  runDBTTest(modelPath: Uri, testName: string) {
    const project = this.projects.get(modelPath);
    if (!project) {
      return;
    }
    void project.runTest(testName);
  }

  runDBTModelTest(modelPath: Uri) {
    const project = this.projects.get(modelPath);
    if (!project) {
      return;
    }
    void project.runModelTest(path.basename(modelPath.fsPath, ".sql"));
  }

  async executeSQL(uri: Uri, query: string, modelName: string) {
    const declared = await this.projectContext.requireForCommand(uri);
    if (!declared) {
      return;
    }
    const project = this.projects.get(declared.root);
    if (!project) {
      return;
    }
    void project.executeSQLOnQueryPanel(query, modelName);
  }

  generateSchemaYML(modelPath: Uri) {
    const project = this.projects.get(modelPath);
    if (!project) {
      return;
    }
    void project.generateSchemaYML(
      modelPath,
      path.basename(modelPath.fsPath, ".sql"),
    );
  }

  showRunSQL(modelPath: Uri) {
    const project = this.projects.get(modelPath);
    if (!project) {
      return;
    }
    void project.showRunSQL(modelPath);
  }

  createModelBasedonSourceConfig(params: GenerateModelFromSourceParams) {
    const project = this.projects.get(params.currentDoc);
    const sourcePath = path.dirname(params.currentDoc.fsPath);
    if (project) {
      project.generateModel(params.sourceName, params.tableName, sourcePath);
    } else {
      window.showErrorMessage(
        "Could not generate model! No project found for " +
          params.currentDoc.fsPath +
          ".",
      );
    }
  }
}
