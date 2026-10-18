import type { Table } from "../../core/dbt/domain";
import type { NodeGraphMap } from "../../core/manifest/types";
import {
  RESOURCE_TYPE_EXPOSURE,
  RESOURCE_TYPE_FUNCTION,
  RESOURCE_TYPE_METRIC,
  RESOURCE_TYPE_SOURCE,
} from "../../core/manifest/types";
import type { Manifest } from "../../projects/manifest/manifestTypes";

/** A node's data-flow neighbour count; foreign-key-only edges are left out, as the panel never draws them. */
function connectedNodeCount(g: NodeGraphMap, key: string): number {
  return (g.get(key)?.nodes ?? []).filter((n) => n.edgeType !== "constraint")
    .length;
}

/** The tests on `key`, as the lineage table lists them. */
function testsOf(event: Manifest, key: string): Table["tests"] {
  return (event.graphMetaMap.tests.get(key)?.nodes ?? []).map((n) => {
    const testKey = n.label.split(".")[0] ?? "";
    return { ...event.testMetaMap.get(testKey), key: testKey };
  });
}

/** The lineage table for the node `key` (a dbt unique id), or undefined when the manifest does not know it. */
export function lineageTable(
  event: Manifest,
  tableUrl: string | undefined,
  key: string,
): Table | undefined {
  const splits = key.split(".");
  const at = (index: number) => splits[index] ?? "";
  const nodeType = at(0);
  const base = {
    table: key,
    url: tableUrl,
    childCount: connectedNodeCount(event.graphMetaMap.children, key),
    parentCount: connectedNodeCount(event.graphMetaMap.parents, key),
    nodeType,
  };
  switch (nodeType) {
    case RESOURCE_TYPE_SOURCE:
      return sourceTable(event, base, [at(2), at(3)]);
    case RESOURCE_TYPE_METRIC:
    case RESOURCE_TYPE_EXPOSURE:
      return {
        ...base,
        label: at(2),
        materialization: undefined,
        tests: [],
        columns: {},
      };
    case RESOURCE_TYPE_FUNCTION: {
      const fnType = event.functionMetaMap.get(at(2))?.config?.type;
      return {
        ...base,
        label: at(2),
        materialization: fnType ? `${fnType} function` : "function",
        tests: [],
        columns: {},
      };
    }
    default:
      return nodeTable(event, base, key);
  }
}

type TableBase = Pick<
  Table,
  "table" | "url" | "childCount" | "parentCount" | "nodeType"
>;

function sourceTable(
  event: Manifest,
  base: TableBase,
  [sourceName, tableName]: [string, string],
): Table | undefined {
  const source = event.sourceMetaMap.get(sourceName);
  const table = source?.tables.find((t) => t.name === tableName);
  if (!source || !table) {
    return undefined;
  }
  return {
    ...base,
    label: tableName,
    tests: testsOf(event, base.table),
    columns: table.columns,
    description: table.description,
    packageName: source.package_name,
  };
}

function nodeTable(
  event: Manifest,
  base: TableBase,
  key: string,
): Table | undefined {
  const node = event.nodeMetaMap.lookupByUniqueId(key);
  if (!node) {
    return undefined;
  }
  return {
    ...base,
    label: node.alias,
    materialization: node.config.materialized ?? undefined,
    description: node.description,
    columns: node.columns,
    patchPath: node.patch_path ?? "",
    tests: testsOf(event, key),
    packageName: node.package_name,
    meta: node.meta,
  };
}
