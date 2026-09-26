import { ManifestCacheProjectAddedEvent } from "../dbt_client/event/manifestCacheChangedEvent";
import {
  GraphMetaMap,
  NodeGraphMap,
  RESOURCE_TYPE_EXPOSURE,
  RESOURCE_TYPE_FUNCTION,
  RESOURCE_TYPE_METRIC,
  RESOURCE_TYPE_SOURCE,
  Table,
} from "../dbt_integration";
import { QueryManifestService } from "../modules";

export class DbtLineageService {
  public constructor(private queryManifestService: QueryManifestService) {}

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
}
