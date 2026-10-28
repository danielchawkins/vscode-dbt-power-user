import { ProgressLocation, window } from "vscode";
import { panelColumns } from "../../core/lineage";
import type { Log } from "../../core/log";
import { RelationshipParser } from "../../core/manifest";
import type {
  ExposureMetaData,
  FunctionMetaData,
  Ref,
  SourceTable,
} from "../../core/manifest/types";
import {
  RESOURCE_TYPE_FUNCTION,
  RESOURCE_TYPE_SOURCE,
} from "../../core/manifest/types";
import type { Manifest } from "../../projects/manifest/manifestTypes";
import { notifyError } from "../../projects/output/notifications";
import type { CurrentProject } from "../../projects/project/currentProject";
import type { Project } from "../../projects/project/project";
import type { ProjectQueries } from "../../projects/project/projectQueries";

/** What the details read from the current project. */
type DetailsProject = Pick<Project, "root" | "getProjectName"> & {
  queries: Pick<ProjectQueries, "getColumnsOfSource" | "mergeColumnsFromDB">;
};

import type { LineageService } from "./lineageService";

/** What the lineage panel shows for one node's columns. */
export interface ColumnsBody {
  id: string;
  purpose: string;
  columns: {
    table: string;
    name: string;
    datatype: string;
    can_lineage_expand: boolean;
    description: string;
  }[];
  returns?: { datatype: string; description: string } | undefined;
  meta?: Record<string, unknown> | undefined;
}

/** The lineage panel's detail requests: relationships, exposures, functions and columns of a node. */
export class LineageDetails {
  private readonly currentProject: CurrentProject;
  private readonly dbtLineageService: LineageService;
  private readonly terminal: Log;

  constructor(
    currentProject: CurrentProject,
    dbtLineageService: LineageService,
    terminal: Log,
  ) {
    this.currentProject = currentProject;
    this.dbtLineageService = dbtLineageService;
    this.terminal = terminal;
  }

  /**
   * Extract PK/FK relationships from the current project's manifest.
   * Chains the `relationships` data tests, model contract foreign keys,
   * `meta.relationships` declarations, naming-convention inference and
   * semantic-layer entity pairings. Each ref carries a `source` discriminator
   * so the frontend can filter and style per-source. Sources are excluded by
   * default — opt-in via params.
   */
  getRelationships(params?: { includeSources?: boolean | undefined }): {
    refs: Ref[];
  } {
    const manifest = this.currentProject.current?.manifest;
    if (!manifest) {
      return { refs: [] };
    }
    const { testMetaMap, nodeMetaMap, sourceMetaMap, semanticModelMetaMap } =
      manifest;
    const parser = new RelationshipParser(this.terminal);

    const fromTests = parser.fromTests(testMetaMap);
    const fromContracts = parser.fromContracts(nodeMetaMap, sourceMetaMap);
    const fromMeta = parser.fromMeta(nodeMetaMap, sourceMetaMap);
    const fromInference = parser.fromInference(nodeMetaMap, sourceMetaMap, {
      // Emit at the parser's lowest acceptable confidence; UI applies the
      // user-controlled threshold via the popover slider.
      minConfidence: 0.6,
      includeSources: params?.includeSources ?? false,
    });
    const fromSemantic = parser.fromSemanticEntities(semanticModelMetaMap);

    const refs = [
      ...fromTests,
      ...fromContracts,
      ...fromMeta,
      ...fromInference,
      ...fromSemantic,
    ];
    this.terminal.debug(
      "LineagePanel",
      `getRelationships returning ${refs.length} refs (` +
        `tests=${fromTests.length}, contracts=${fromContracts.length}, ` +
        `meta=${fromMeta.length}, inferred=${fromInference.length}, ` +
        `semantic=${fromSemantic.length})`,
    );
    return { refs };
  }

  async getExposureDetails({
    name,
  }: {
    name: string;
  }): Promise<ExposureMetaData | undefined> {
    const project = this.currentProject.current;
    const manifest = project?.manifest;
    if (!project || !manifest) {
      return;
    }

    const { exposureMetaMap } = manifest;

    // Node IDs use unique_id format (exposure.project.name), but
    // exposureMetaMap is keyed by simple exposure name.
    const splits = name.split(".");
    const exposureName = splits.length >= 3 ? (splits[2] ?? name) : name;
    return exposureMetaMap.get(exposureName);
  }

  async getFunctionDetails({
    name,
  }: {
    name: string;
  }): Promise<FunctionMetaData | undefined> {
    const manifest = this.currentProject.current?.manifest;
    if (!manifest) {
      return;
    }
    const { functionMetaMap } = manifest;
    // Node IDs use unique_id format (function.project.name), but
    // functionMetaMap is keyed by simple function name.
    const splits = name.split(".");
    const functionName = splits.length >= 3 ? (splits[2] ?? name) : name;
    return functionMetaMap.get(functionName);
  }

  async getColumns({
    table,
    refresh,
  }: {
    table: string;
    refresh: boolean;
  }): Promise<ColumnsBody | undefined> {
    const project = this.currentProject.current;
    const manifest = project?.manifest;
    if (!manifest || !project) {
      return;
    }
    const splits = table.split(".");
    if (splits[0] === RESOURCE_TYPE_SOURCE) {
      return this.sourceColumns({
        manifest,
        project,
        table,
        splits,
        refresh,
      });
    }
    if (splits[0] === RESOURCE_TYPE_FUNCTION) {
      return this.functionColumns(manifest, table, splits[2] ?? "");
    }
    const node = manifest.nodeMetaMap.lookupByUniqueId(table);
    if (!node) {
      return;
    }
    // `refresh` is ignored: the language server already supplies model columns and types.
    const inferred = node.path
      ? await this.dbtLineageService.getInferredColumns(
          project.root.fsPath,
          node.path,
        )
      : undefined;
    return {
      id: table,
      purpose: node.description,
      columns: panelColumns(table, Object.values(node.columns), inferred),
      meta: node.meta,
    };
  }

  private async sourceColumns({
    manifest,
    project,
    table,
    splits,
    refresh,
  }: {
    manifest: Manifest;
    project: DetailsProject;
    table: string;
    splits: string[];
    refresh: boolean;
  }): Promise<ColumnsBody | undefined> {
    const node = manifest.sourceMetaMap.get(splits[2] ?? "");
    const sourceTable = node?.tables.find((t) => t.name === splits[3]);
    if (!node || !sourceTable) {
      return;
    }
    if (
      refresh &&
      !(await this.refreshFromDatabase(project, node.name, sourceTable))
    ) {
      void notifyError(
        project,
        `Unable to get columns from the database for model ${node.name}, table ${sourceTable.name}`,
      );
      return;
    }
    return {
      id: table,
      purpose: sourceTable.description,
      columns: Object.values(sourceTable.columns)
        .map((c) => ({
          table,
          name: c.name,
          datatype: c.data_type?.toLowerCase() || "",
          can_lineage_expand: false,
          description: c.description,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  private refreshFromDatabase(
    project: DetailsProject,
    nodeName: string,
    sourceTable: SourceTable,
  ) {
    return window.withProgress(
      {
        title: "Fetching metadata",
        location: ProgressLocation.Notification,
        cancellable: false,
      },
      () => this.addSourceColumnsFromDB(project, nodeName, sourceTable),
    );
  }

  private functionColumns(
    manifest: Manifest,
    table: string,
    functionName: string,
  ): ColumnsBody | undefined {
    const fn = manifest.functionMetaMap.get(functionName);
    if (!fn) {
      return;
    }
    return {
      id: table,
      purpose: fn.description ?? "",
      columns: (fn.arguments ?? []).map((arg) => ({
        table,
        name: arg.name,
        datatype: arg.data_type || "",
        can_lineage_expand: false,
        description: arg.description ?? "",
      })),
      returns: fn.returns
        ? {
            datatype: fn.returns.data_type || "",
            description: fn.returns.description ?? "",
          }
        : undefined,
    };
  }

  private async addSourceColumnsFromDB(
    project: DetailsProject,
    nodeName: string,
    table: SourceTable,
  ) {
    const columnsFromDB = await project.queries.getColumnsOfSource(
      nodeName,
      table.name,
    );
    this.terminal.debug("Lineage:addColumnsFromDB", nodeName, columnsFromDB);
    return project.queries.mergeColumnsFromDB(table, columnsFromDB);
  }
}
