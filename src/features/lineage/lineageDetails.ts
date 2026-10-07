import { ProgressLocation, window } from "vscode";
import { panelColumns } from "../../core/lineage";
import type { Log } from "../../core/log";
import { RelationshipParser } from "../../core/manifest";
import {
  ExposureMetaData,
  FunctionMetaData,
  Ref,
  RESOURCE_TYPE_FUNCTION,
  RESOURCE_TYPE_SOURCE,
  SourceTable,
} from "../../core/manifest/types";
import type { Manifest } from "../../projects/manifestTypes";
import { notifyError } from "../../projects/notifications";
import type { Project } from "../../projects/project";
import type { QueryManifestService } from "../../projects/queryManifestService";
import type { DbtLineageService } from "./dbtLineageService";

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
  constructor(
    private readonly queryManifestService: QueryManifestService,
    private readonly dbtLineageService: DbtLineageService,
    private readonly terminal: Log,
  ) {}

  /**
   * Extract PK/FK relationships from the current project's manifest.
   * Chains all four sources — `relationships` data tests, model contract
   * foreign keys, naming-convention inference, and semantic-layer entity
   * pairings. Each ref carries a `source` discriminator so the frontend can
   * filter and style per-source. Sources are excluded by default — opt-in via
   * params.
   */
  getRelationships(params?: { includeSources?: boolean }): {
    refs: Ref[];
  } {
    const event = this.queryManifestService.getEventByCurrentProject();
    if (!event?.event) {
      return { refs: [] };
    }
    const { testMetaMap, nodeMetaMap, sourceMetaMap, semanticModelMetaMap } =
      event.event;
    const parser = new RelationshipParser(this.terminal);

    const fromTests = parser.fromTests(testMetaMap);
    const fromContracts = parser.fromContracts(nodeMetaMap, sourceMetaMap);
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
      ...fromInference,
      ...fromSemantic,
    ];
    this.terminal.debug(
      "LineagePanel",
      `getRelationships returning ${refs.length} refs (` +
        `tests=${fromTests.length}, contracts=${fromContracts.length}, ` +
        `inferred=${fromInference.length}, semantic=${fromSemantic.length})`,
    );
    return { refs };
  }

  async getExposureDetails({
    name,
  }: {
    name: string;
  }): Promise<ExposureMetaData | undefined> {
    const event = this.queryManifestService.getEventByCurrentProject();
    if (!event?.event) {
      return;
    }
    const project = this.queryManifestService.getProject();
    if (!project) {
      return;
    }

    const { exposureMetaMap } = event.event;

    // Node IDs use unique_id format (exposure.project.name), but
    // exposureMetaMap is keyed by simple exposure name.
    const splits = name.split(".");
    const exposureName = splits.length >= 3 ? splits[2] : name;
    return exposureMetaMap.get(exposureName);
  }

  async getFunctionDetails({
    name,
  }: {
    name: string;
  }): Promise<FunctionMetaData | undefined> {
    const event = this.queryManifestService.getEventByCurrentProject();
    if (!event?.event) {
      return;
    }
    const { functionMetaMap } = event.event;
    // Node IDs use unique_id format (function.project.name), but
    // functionMetaMap is keyed by simple function name.
    const splits = name.split(".");
    const functionName = splits.length >= 3 ? splits[2] : name;
    return functionMetaMap.get(functionName);
  }

  async getColumns({
    table,
    refresh,
  }: {
    table: string;
    refresh: boolean;
  }): Promise<ColumnsBody | undefined> {
    const event = this.queryManifestService.getEventByCurrentProject();
    const project = this.queryManifestService.getProject();
    if (!event?.event || !project) {
      return;
    }
    const splits = table.split(".");
    if (splits[0] === RESOURCE_TYPE_SOURCE) {
      return this.sourceColumns(event.event, project, table, splits, refresh);
    }
    if (splits[0] === RESOURCE_TYPE_FUNCTION) {
      return this.functionColumns(event.event, table, splits[2]);
    }
    const node = event.event.nodeMetaMap.lookupByUniqueId(table);
    if (!node) {
      return;
    }
    // `refresh` is ignored: the language server already supplies model columns and types.
    const inferred = node.path
      ? await this.dbtLineageService.getInferredColumns(
          project.projectRoot.fsPath,
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

  private async sourceColumns(
    event: Manifest,
    project: Project,
    table: string,
    splits: string[],
    refresh: boolean,
  ): Promise<ColumnsBody | undefined> {
    const node = event.sourceMetaMap.get(splits[2]);
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
    project: Project,
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
    event: Manifest,
    table: string,
    functionName: string,
  ): ColumnsBody | undefined {
    const fn = event.functionMetaMap.get(functionName);
    if (!fn) {
      return;
    }
    return {
      id: table,
      purpose: fn.description || "",
      columns: (fn.arguments ?? []).map((arg) => ({
        table,
        name: arg.name,
        datatype: arg.data_type || "",
        can_lineage_expand: false,
        description: arg.description || "",
      })),
      returns: fn.returns
        ? {
            datatype: fn.returns.data_type || "",
            description: fn.returns.description || "",
          }
        : undefined,
    };
  }

  private async addSourceColumnsFromDB(
    project: Project,
    nodeName: string,
    table: SourceTable,
  ) {
    const columnsFromDB = await project.getColumnsOfSource(
      nodeName,
      table.name,
    );
    this.terminal.debug("Lineage:addColumnsFromDB", nodeName, columnsFromDB);
    return project.mergeColumnsFromDB(table, columnsFromDB);
  }
}
