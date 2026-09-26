import { inject } from "inversify";
import { CancellationTokenSource, window } from "vscode";
import { ManifestCacheProjectAddedEvent } from "../dbt_client/event/manifestCacheChangedEvent";
import {
  computeColumnLineage,
  GraphMetaMap,
  NodeGraphMap,
  RESOURCE_TYPE_ANALYSIS,
  RESOURCE_TYPE_EXPOSURE,
  RESOURCE_TYPE_FUNCTION,
  RESOURCE_TYPE_METRIC,
  RESOURCE_TYPE_MODEL,
  RESOURCE_TYPE_SNAPSHOT,
  RESOURCE_TYPE_SOURCE,
  Table,
} from "../dbt_integration";
import { ModelInfo } from "../local/lineageTypes";
import { DBTTerminal, QueryManifestService } from "../modules";
export enum CllEvents {
  START = "start",
  END = "end",
  CANCEL = "cancel",
}

const CAN_COMPILE_SQL_NODE = [
  RESOURCE_TYPE_MODEL,
  RESOURCE_TYPE_SNAPSHOT,
  RESOURCE_TYPE_ANALYSIS,
];
const canCompileSQL = (nodeType: string) =>
  CAN_COMPILE_SQL_NODE.includes(nodeType);

export type ColumnLineageCompute = typeof computeColumnLineage;

export class DbtLineageService {
  private columnLineageCompute: ColumnLineageCompute;

  public constructor(
    @inject("DBTTerminal")
    private dbtTerminal: DBTTerminal,
    private queryManifestService: QueryManifestService,
    columnLineageCompute?: ColumnLineageCompute,
  ) {
    this.columnLineageCompute = columnLineageCompute ?? computeColumnLineage;
  }

  getUpstreamTables({ table }: { table: string }) {
    return { tables: this.getConnectedTables("children", table) };
  }

  getDownstreamTables({ table }: { table: string }) {
    return { tables: this.getConnectedTables("parents", table) };
  }

  private getConnectedTables(
    key: keyof GraphMetaMap,
    table: string,
  ): Table[] | undefined {
    const _event = this.queryManifestService.getEventByCurrentProject();
    if (!_event) {
      return;
    }
    const { event } = _event;
    if (!event) {
      return;
    }
    const { graphMetaMap } = event;
    const dependencyNodes = graphMetaMap[key];
    const node = dependencyNodes.get(table);
    if (!node) {
      return;
    }
    const tables: Map<string, Table> = new Map();
    node.nodes
      // Hide foreign-key-only edges: the parent is referenced by a declared FK
      // constraint but never read by the model's SQL, so it isn't a data-flow
      // edge. The edge still exists in graphMetaMap for build order / impact
      // analysis; only this data-flow lineage view drops it.
      .filter((n) => n.edgeType !== "constraint")
      .forEach(({ url, key }) => {
        const _node = this.createTable(event, url, key);
        if (!_node) {
          return;
        }
        if (!tables.has(_node.table)) {
          tables.set(_node.table, _node);
        }
      });
    return Array.from(tables.values()).sort((a, b) =>
      a.table.localeCompare(b.table),
    );
  }

  createTable(
    event: ManifestCacheProjectAddedEvent,
    tableUrl: string | undefined,
    key: string,
  ): Table | undefined {
    const splits = key.split(".");
    const nodeType = splits[0];
    const { graphMetaMap, testMetaMap } = event;
    const upstreamCount = this.getConnectedNodeCount(
      graphMetaMap["children"],
      key,
    );
    const downstreamCount = this.getConnectedNodeCount(
      graphMetaMap["parents"],
      key,
    );
    if (nodeType === RESOURCE_TYPE_SOURCE) {
      const { sourceMetaMap } = event;
      const schema = splits[2];
      const table = splits[3];
      const _node = sourceMetaMap.get(schema);
      if (!_node) {
        return;
      }
      const _table = _node.tables.find((t) => t.name === table);
      if (!_table) {
        return;
      }
      return {
        table: key,
        label: table,
        url: tableUrl,
        upstreamCount,
        downstreamCount,
        nodeType,
        isExternalProject: _node.is_external_project,
        tests: (graphMetaMap["tests"].get(key)?.nodes || []).map((n) => {
          const testKey = n.label.split(".")[0];
          return { ...testMetaMap.get(testKey), key: testKey };
        }),
        columns: _table.columns,
        description: _table?.description,
        packageName: _node.package_name,
      };
    }
    if (nodeType === RESOURCE_TYPE_METRIC) {
      return {
        table: key,
        label: splits[2],
        url: tableUrl,
        upstreamCount,
        downstreamCount,
        nodeType,
        materialization: undefined,
        tests: [],
        columns: {},
        isExternalProject: false,
      };
    }
    const { nodeMetaMap } = event;

    const table = splits[2];
    if (nodeType === RESOURCE_TYPE_EXPOSURE) {
      return {
        table: key,
        label: table,
        url: tableUrl,
        upstreamCount,
        downstreamCount,
        nodeType,
        materialization: undefined,
        tests: [],
        columns: {},
        isExternalProject: false,
      };
    }

    if (nodeType === RESOURCE_TYPE_FUNCTION) {
      const { functionMetaMap } = event;
      const fn = functionMetaMap.get(table);
      const fnType = fn?.config?.type;
      return {
        table: key,
        label: table,
        url: tableUrl,
        upstreamCount,
        downstreamCount,
        nodeType,
        materialization: fnType ? `${fnType} function` : "function",
        tests: [],
        columns: {},
        isExternalProject: fn?.is_external_project ?? false,
      };
    }

    const node = nodeMetaMap.lookupByUniqueId(key);
    if (!node) {
      return;
    }

    const materialization = node.config.materialized;
    return {
      table: key,
      label: node.alias,
      url: tableUrl,
      upstreamCount,
      downstreamCount,
      isExternalProject: node.is_external_project,
      nodeType,
      materialization,
      description: node.description,
      columns: node.columns,
      patchPath: node.patch_path,
      tests: (graphMetaMap["tests"].get(key)?.nodes || []).map((n) => {
        const testKey = n.label.split(".")[0];
        return { ...testMetaMap.get(testKey), key: testKey };
      }),
      packageName: node.package_name,
      meta: node.meta,
    };
  }

  private getConnectedNodeCount(g: NodeGraphMap, key: string) {
    // Exclude FK-only edges so the upstream/downstream counts match the
    // data-flow edges actually drawn in the lineage panel.
    return (g.get(key)?.nodes || []).filter((n) => n.edgeType !== "constraint")
      .length;
  }

  async getConnectedColumns(
    {
      targets,
      upstreamExpansion,
      currAnd1HopTables,
      selectedColumn,
      showIndirectEdges,
    }: {
      targets: [string, string][];
      upstreamExpansion: boolean;
      currAnd1HopTables: string[];
      selectedColumn: { name: string; table: string };
      showIndirectEdges: boolean;
    },
    cancellationTokenSource: CancellationTokenSource,
  ) {
    const _event = this.queryManifestService.getEventByCurrentProject();
    if (!_event) {
      return;
    }
    const { event } = _event;
    if (!event) {
      return;
    }
    const project = this.queryManifestService.getProject();
    if (!project) {
      return;
    }

    const modelInfos: ModelInfo[] = [];
    let auxiliaryTables: string[] = [];
    let sqlTables: string[] = [];
    currAnd1HopTables = Array.from(new Set(currAnd1HopTables));
    const currTables = new Set(targets.map((t) => t[0]));
    if (upstreamExpansion) {
      const hop1Tables = currAnd1HopTables.filter((t) => !currTables.has(t));
      sqlTables = [...hop1Tables];
      auxiliaryTables = project.getNonEphemeralParents(hop1Tables);
    } else {
      auxiliaryTables = project.getNonEphemeralParents(Array.from(currTables));
      sqlTables = Array.from(currTables);
    }
    currAnd1HopTables = Array.from(new Set(currAnd1HopTables));
    const modelsToFetch = Array.from(
      new Set([...currAnd1HopTables, ...auxiliaryTables, selectedColumn.table]),
    );
    // using artifacts(mappedCompiledSql) from getNodesWithDBColumns as optimization
    const abortController = new AbortController();
    cancellationTokenSource.token.onCancellationRequested(() =>
      abortController.abort(),
    );
    const { mappedNode, relationsWithoutColumns, mappedCompiledSql } =
      await project.getNodesWithDBColumns(
        modelsToFetch,
        abortController.signal,
      );

    if (cancellationTokenSource.token.isCancellationRequested) {
      return;
    }

    const modelsToCompile = modelsToFetch.filter((key) => {
      if (!sqlTables.includes(key)) {
        return false;
      }
      const nodeType = key.split(".")[0];
      if (!canCompileSQL(nodeType)) {
        return false;
      }
      return true;
    });
    const bulkCompiledSql = await project.getBulkCompiledSql(
      modelsToCompile.filter((m) => !mappedCompiledSql[m]),
    );
    for (const key of modelsToFetch) {
      const node = mappedNode[key];
      if (!node) {
        continue;
      }
      if (modelsToCompile.includes(key)) {
        modelInfos.push({
          model_node: node,
          compiled_sql: mappedCompiledSql[key] || bulkCompiledSql[key],
        });
      } else {
        modelInfos.push({ model_node: node });
      }
    }

    if (relationsWithoutColumns.length !== 0) {
      window.showErrorMessage(
        "Failed to fetch columns for " +
          relationsWithoutColumns.join(", ") +
          ". Probably the dbt models are not yet materialized.",
      );
      // we still show the lineage for the rest of the models whose
      // schemas we could get so not returning here
    }

    const targetTables = Array.from(new Set(targets.map((t) => t[0])));
    // targets should not empty
    if (targets.length === 0 || modelInfos.length < targetTables.length) {
      this.dbtTerminal.error(
        "columnLineageLogicError",
        "Unable to match lineage targets to models",
        undefined,
        false,
        {
          targets,
          modelInfos,
          upstreamExpansion,
          currAnd1HopTables,
        },
      );
      return { column_lineage: [] };
    }

    // the case where upstream/downstream only has ephemeral models
    if (modelInfos.length === targetTables.length) {
      return { column_lineage: [] };
    }
    const models = modelInfos.map((m) => m.model_node.uniqueId);
    const hasAllModels = targets.every((t) => models.includes(t[0]));
    if (!hasAllModels) {
      // most probably error message is already shown in above checks
      return { column_lineage: [] };
    }

    const modelDialect = project.getAdapterType();

    try {
      const localResult = await this.columnLineageCompute(
        modelDialect,
        modelInfos,
        {
          showIndirectEdges,
          isCancelled: () =>
            cancellationTokenSource.token.isCancellationRequested,
        },
      );

      // Check cancellation before returning to avoid partial results.
      if (cancellationTokenSource.token.isCancellationRequested) {
        return;
      }

      if (localResult) {
        this.dbtTerminal.debug(
          "dbtLineageService:getConnectedColumns",
          "local column lineage result",
          {
            lineageCount: localResult.column_lineage.length,
            errors: localResult.errors,
          },
        );
        return localResult;
      }

      window.showErrorMessage(
        "Unable to compute column lineage. The native SQL engine is not loaded.",
      );
      this.dbtTerminal.warn(
        "dbtLineageService:getConnectedColumns",
        "computeColumnLineage returned null",
      );
      return;
    } catch (error) {
      window.showErrorMessage(
        "Unable to compute column lineage: " +
          (error instanceof Error ? error.message : String(error)),
      );
      this.dbtTerminal.error(
        "dbtLineageService:getConnectedColumns",
        "local column lineage computation failed",
        error,
        false,
      );
      return;
    }
  }
}
