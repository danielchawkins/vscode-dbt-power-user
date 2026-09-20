import {
  DBTTerminal,
  NodeMetaData,
  RESOURCE_TYPE_MODEL,
} from "@altimateai/dbt-integration";
import { promises as fs } from "fs";
import { inject } from "inversify";
import * as yaml from "js-yaml";
import { Uri, window } from "vscode";
import { DBTProjectContainer } from "../dbt_client/dbtProjectContainer";
import { removeProtocol } from "../utils";
import { DBTDocumentation, Source } from "../webview_provider/docsEditPanel";
import { QueryManifestService } from "./queryManifestService";
import path = require("path");

interface DBTDocumentationMessage {
  documentation: DBTDocumentation | undefined;
  message?: { message: string; type: string };
}

export interface DocumentationSchemaColumn {
  name: string;
  description: string;
  data_type?: string;
  quote?: boolean;
  [key: string]: unknown;
}

interface DocumentationSchemaModel {
  name: string;
  description: string;
  tests: any;
  columns: { name: string; description?: string; data_type?: string }[];
}

export interface DocumentationSchema {
  version: number;
  models: DocumentationSchemaModel[];
}

export class DocGenService {
  public constructor(
    protected dbtProjectContainer: DBTProjectContainer,
    private queryManifestService: QueryManifestService,
    @inject("DBTTerminal")
    private dbtTerminal: DBTTerminal,
  ) {}

  private getCompiledDocumentationFromNode(
    currentNode: NodeMetaData | undefined,
    modelName: string,
    filePath: string,
  ): DBTDocumentation | undefined {
    if (!currentNode) {
      return;
    }
    return {
      name: modelName,
      patchPath: currentNode.patch_path,
      description: currentNode.description,
      generated: false,
      uniqueId: currentNode.unique_id,
      resource_type: currentNode.resource_type,
      filePath,
      columns: Object.values(currentNode.columns).map((column) => ({
        name: column.name,
        description: column.description,
        generated: false,
        source: Source.YAML,
        type: column.data_type?.toLowerCase(),
      })),
    };
  }

  private getCurrentNode(modelName: string): NodeMetaData | undefined {
    return this.queryManifestService
      .getEventByCurrentProject()
      ?.event?.nodeMetaMap.lookupByBaseName(modelName);
  }

  public async getCompiledDocumentationForCurrentActiveFile() {
    return this.getCompiledDocumentation(
      window.activeTextEditor?.document?.uri.fsPath,
    );
  }

  public async getUncompiledDocumentationForCurrentActiveFile() {
    return this.getUncompiledDocumentation(
      window.activeTextEditor?.document?.uri.fsPath,
    );
  }

  private getDocumentationValidationMessage(
    filePath?: string,
    context?: "project" | "node" | "resource_type" | "model_path",
  ) {
    if (!filePath?.endsWith(".sql")) {
      return {
        message:
          "Documentation is only available for .sql files. Please open a dbt model (.sql) file.",
        type: "warning",
      };
    }

    try {
      this.queryManifestService
        .getProjectByUri(Uri.file(filePath))
        ?.throwDiagnosticsErrorIfAvailable();
    } catch (err) {
      return { message: (err as Error).message, type: "error" };
    }

    if (context === "project") {
      return {
        message:
          "Unable to find dbt project or project root for this file. Ensure the file is part of a valid dbt project.",
        type: "warning",
      };
    }
    if (context === "node") {
      return {
        message:
          "Model not found in dbt manifest. Ensure the model has been compiled and exists in the dbt project.",
        type: "warning",
      };
    }
    if (context === "resource_type") {
      return {
        message:
          "Documentation is only available for dbt models. This file appears to be another dbt resource type.",
        type: "warning",
      };
    }
    return {
      message:
        "A valid dbt model file needs to be open and active in the editor area above to view documentation.",
      type: "warning",
    };
  }

  private async getDocumentation(
    filePath?: string,
    compiled = true,
  ): Promise<DBTDocumentationMessage> {
    const initialValidation = this.getDocumentationValidationMessage(filePath);
    if (initialValidation.type === "error" || !filePath) {
      return { documentation: undefined, message: initialValidation };
    }

    const modelName = path.basename(filePath, ".sql");
    const project = this.dbtProjectContainer.findDBTProject(Uri.file(filePath));
    if (!project?.projectRoot) {
      return {
        documentation: undefined,
        message: this.getDocumentationValidationMessage(filePath, "project"),
      };
    }

    const modelPaths = project.getModelPaths();
    if (
      !modelPaths?.some(
        (modelPath) =>
          filePath.startsWith(modelPath + path.sep) ||
          path.dirname(filePath) === modelPath,
      )
    ) {
      return {
        documentation: undefined,
        message: this.getDocumentationValidationMessage(filePath, "model_path"),
      };
    }

    const currentNode = this.getCurrentNode(modelName);
    if (!currentNode) {
      return {
        documentation: undefined,
        message: this.getDocumentationValidationMessage(filePath, "node"),
      };
    }
    if (currentNode.resource_type !== RESOURCE_TYPE_MODEL) {
      return {
        documentation: undefined,
        message: this.getDocumentationValidationMessage(
          filePath,
          "resource_type",
        ),
      };
    }

    if (compiled) {
      return {
        documentation: this.getCompiledDocumentationFromNode(
          currentNode,
          modelName,
          filePath,
        ),
      };
    }

    const emptyDocumentation: DBTDocumentation = {
      name: modelName,
      description: "",
      uniqueId: currentNode.unique_id,
      resource_type: currentNode.resource_type,
      generated: false,
      filePath,
      columns: [],
    };
    if (!currentNode.patch_path) {
      return { documentation: emptyDocumentation };
    }

    try {
      const yamlPath = path.join(
        project.projectRoot.fsPath,
        removeProtocol(currentNode.patch_path),
      );
      const content = await fs.readFile(yamlPath, "utf8");
      const parsedDoc = yaml.load(content) as DocumentationSchema;
      const modelDef = parsedDoc.models?.find(
        (model) => model.name === modelName,
      );
      if (!modelDef) {
        return { documentation: emptyDocumentation };
      }
      return {
        documentation: {
          ...emptyDocumentation,
          patchPath: currentNode.patch_path,
          description: modelDef.description || "",
          columns: (modelDef.columns || []).map((column) => ({
            name: column.name,
            description: column.description || "",
            generated: false,
            source: Source.YAML,
            type: column.data_type?.toLowerCase(),
          })),
        },
      };
    } catch (error) {
      this.dbtTerminal.error(
        "docGenService:getDocumentationYamlError",
        `Error reading YAML documentation: ${error}`,
        error,
      );
      return this.getDocumentation(filePath, true);
    }
  }

  public async getCompiledDocumentation(
    filePath?: string,
  ): Promise<DBTDocumentationMessage> {
    return this.getDocumentation(filePath, true);
  }

  public async getUncompiledDocumentation(
    filePath?: string,
  ): Promise<DBTDocumentationMessage> {
    return this.getDocumentation(filePath, false);
  }
}
