import type { PanelNotice } from "@fusion-power-user/webview-contract";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { Uri, window } from "vscode";
import { parse as parseYaml } from "yaml";
import type { NodeMetaData } from "../../core/manifest/types";
import { RESOURCE_TYPE_MODEL } from "../../core/manifest/types";
import { errorText, removeProtocol } from "../../core/text";
import type { Project } from "../../projects/project/project";
import type { Projects } from "../../projects/project/projects";
import type { QueryManifestService } from "../../projects/project/queryManifestService";
import { activeModelUri } from "../../projects/registry/previewUri";
import type { DBTDocumentation } from "./docGenTypes";
import { Source } from "./docGenTypes";

interface DBTDocumentationMessage {
  documentation: DBTDocumentation | undefined;
  message?: PanelNotice;
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
  tests: unknown;
  columns: { name: string; description?: string; data_type?: string }[];
}

export interface DocumentationSchema {
  version: number;
  models: DocumentationSchemaModel[];
}

/** A model whose documentation can be read: its node, and the project that holds it. */
interface OpenModel {
  filePath: string;
  modelName: string;
  project: Project;
  node: NodeMetaData;
}

export class DocGenService {
  protected projects: Projects;
  private queryManifestService: QueryManifestService;

  public constructor(
    projects: Projects,
    queryManifestService: QueryManifestService,
  ) {
    this.projects = projects;
    this.queryManifestService = queryManifestService;
  }

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
      patchPath: currentNode.patch_path ?? "",
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
    return this.getCompiledDocumentation(activeModelPath());
  }

  public async getUncompiledDocumentationForCurrentActiveFile() {
    return this.getUncompiledDocumentation(activeModelPath());
  }

  private getDocumentationValidationMessage(
    filePath?: string,
    context?: "project" | "node" | "resource_type" | "model_path",
  ): PanelNotice {
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

  /**
   * Checks that `filePath` is a model whose documentation can be read, or says why not. Only an error or a missing path
   * stops the check: a non-`.sql` file gets a warning here and goes on to the later checks.
   */
  private documentationGate(
    filePath?: string,
  ): { stop: DBTDocumentationMessage } | { model: OpenModel } {
    const initialValidation = this.getDocumentationValidationMessage(filePath);
    if (initialValidation.type === "error" || !filePath) {
      return { stop: { documentation: undefined, message: initialValidation } };
    }

    const modelName = path.basename(filePath, ".sql");
    const project = this.projects.get(Uri.file(filePath));
    if (!project?.projectRoot) {
      return {
        stop: {
          documentation: undefined,
          message: this.getDocumentationValidationMessage(filePath, "project"),
        },
      };
    }

    const modelPaths = project.paths()?.modelPaths;
    if (
      !modelPaths?.some(
        (modelPath) =>
          filePath.startsWith(modelPath + path.sep) ||
          path.dirname(filePath) === modelPath,
      )
    ) {
      return {
        stop: {
          documentation: undefined,
          message: this.getDocumentationValidationMessage(
            filePath,
            "model_path",
          ),
        },
      };
    }

    const currentNode = this.getCurrentNode(modelName);
    if (!currentNode) {
      return {
        stop: {
          documentation: undefined,
          message: this.getDocumentationValidationMessage(filePath, "node"),
        },
      };
    }
    if (currentNode.resource_type !== RESOURCE_TYPE_MODEL) {
      return {
        stop: {
          documentation: undefined,
          message: this.getDocumentationValidationMessage(
            filePath,
            "resource_type",
          ),
        },
      };
    }
    return {
      model: { filePath, modelName, project, node: currentNode },
    };
  }

  private async getDocumentation(
    filePath?: string,
    compiled = true,
  ): Promise<DBTDocumentationMessage> {
    const gate = this.documentationGate(filePath);
    if ("stop" in gate) {
      return gate.stop;
    }
    const { model } = gate;
    const { node, modelName, project } = model;
    if (compiled) {
      return {
        documentation: this.getCompiledDocumentationFromNode(
          node,
          modelName,
          model.filePath,
        ),
      };
    }

    const emptyDocumentation: DBTDocumentation = {
      name: modelName,
      description: "",
      uniqueId: node.unique_id,
      resource_type: node.resource_type,
      generated: false,
      filePath: model.filePath,
      columns: [],
    };
    if (!node.patch_path) {
      return { documentation: emptyDocumentation };
    }

    try {
      const yamlPath = path.join(
        project.projectRoot.fsPath,
        removeProtocol(node.patch_path),
      );
      const content = await readFile(yamlPath, "utf8");
      const parsedDoc = parseYaml(content) as DocumentationSchema;
      const modelDef = parsedDoc.models?.find(
        (entry) => entry.name === modelName,
      );
      return {
        documentation: fromYamlModel(
          emptyDocumentation,
          node.patch_path ?? "",
          modelDef,
        ),
      };
    } catch (error) {
      project.log.error(
        "docGenService:getDocumentationYamlError",
        `Error reading YAML documentation: ${errorText(error)}`,
        error,
      );
      return this.getDocumentation(model.filePath, true);
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

/**
 * The documentation a model's YAML entry gives it, over `empty`: its description and columns, with `patchPath`. A model
 * with no entry keeps `empty`.
 */
function fromYamlModel(
  empty: DBTDocumentation,
  patchPath: string,
  modelDef: DocumentationSchemaModel | undefined,
): DBTDocumentation {
  if (!modelDef) {
    return empty;
  }
  return {
    ...empty,
    patchPath,
    description: modelDef.description || "",
    columns: (modelDef.columns || []).map((column) => ({
      name: column.name,
      description: column.description ?? "",
      generated: false,
      source: Source.YAML,
      type: column.data_type?.toLowerCase(),
    })),
  };
}

/** The active editor model path; a focused compiled preview resolves to its model. */
function activeModelPath(): string | undefined {
  const uri = window.activeTextEditor?.document?.uri;
  return uri && activeModelUri(uri).fsPath;
}
