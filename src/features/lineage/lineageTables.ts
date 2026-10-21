import type { Table } from "../../core/dbt/domain";
import { inferLayer } from "../../core/manifest/modelLayer";
import type { Meta, NodeGraphMap } from "../../core/manifest/types";
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

/**
 * `{ hidden: true }` when `meta.lineage.hidden: true` is set in any of `metas`, else nothing, so most tables
 * carry no flag.
 */
function hiddenPart(...metas: Meta[]): { hidden?: true } {
  const hidden = metas.some((meta) => {
    const lineage = meta?.lineage;
    return (
      typeof lineage === "object" &&
      lineage !== null &&
      "hidden" in lineage &&
      lineage.hidden === true
    );
  });
  return hidden ? { hidden: true } : {};
}

/** What a card shows beyond the manifest: its file, which package is the project's own, and how layers are named. */
export interface CardOptions {
  /** The node's file URL, for the open-file action. */
  url?: string | undefined;
  /** The current project's package name; a node in it shows no package. */
  rootPackage?: string | undefined;
  layer: { tagPrefix: string; fromPath: boolean };
}

const NO_LAYERS: CardOptions = { layer: { tagPrefix: "", fromPath: false } };

/** The lineage table for the node `key` (a dbt unique id), or undefined when the manifest does not know it. */
export function lineageTable(
  event: Manifest,
  key: string,
  options: CardOptions = NO_LAYERS,
): Table | undefined {
  const splits = key.split(".");
  const at = (index: number) => splits[index] ?? "";
  const nodeType = at(0);
  const base = {
    table: key,
    url: options.url,
    childCount: connectedNodeCount(event.graphMetaMap.children, key),
    parentCount: connectedNodeCount(event.graphMetaMap.parents, key),
    nodeType,
  };
  switch (nodeType) {
    case RESOURCE_TYPE_SOURCE:
      return sourceTable(event, { ...base, options }, [at(2), at(3)]);
    case RESOURCE_TYPE_METRIC:
      return {
        ...base,
        label: at(2),
        materialization: undefined,
        tests: [],
        columns: {},
      };
    case RESOURCE_TYPE_EXPOSURE: {
      const exposure = event.exposureMetaMap.get(at(2));
      return {
        ...base,
        label: at(2),
        materialization: undefined,
        tests: [],
        columns: {},
        ...hiddenPart(exposure?.meta, exposure?.config?.meta),
      };
    }
    case RESOURCE_TYPE_FUNCTION: {
      const fn = event.functionMetaMap.get(at(2));
      const fnType = fn?.config?.type;
      return {
        ...base,
        label: at(2),
        materialization: fnType ? `${fnType} function` : "function",
        tests: [],
        columns: {},
        ...hiddenPart(fn?.meta, fn?.config?.meta),
      };
    }
    default:
      return nodeTable(event, { ...base, options }, key);
  }
}

type TableBase = Pick<
  Table,
  "table" | "url" | "childCount" | "parentCount" | "nodeType"
> & { options: CardOptions };

function sourceTable(
  event: Manifest,
  { options, ...base }: TableBase,
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
    rootPackage: source.package_name === options.rootPackage,
    database: table.database ?? source.database,
    schema: table.schema ?? source.schema,
    ...hiddenPart(table.meta),
    ...(table.identifier && table.identifier !== tableName
      ? { refName: `${sourceName}.${tableName}` }
      : {}),
  };
}

function nodeTable(
  event: Manifest,
  { options, ...base }: TableBase,
  key: string,
): Table | undefined {
  const node = event.nodeMetaMap.lookupByUniqueId(key);
  if (!node) {
    return undefined;
  }
  const materialization = node.config.materialized ?? undefined;
  return {
    ...base,
    label: node.alias,
    materialization,
    description: node.description,
    columns: node.columns,
    patchPath: node.patch_path ?? "",
    path: node.original_file_path,
    tests: testsOf(event, key),
    packageName: node.package_name,
    rootPackage: node.package_name === options.rootPackage,
    meta: node.meta,
    ...hiddenPart(node.meta, node.config.meta),
    ...(node.config.schema ? { customSchema: node.config.schema } : {}),
    ...(node.name === node.alias ? {} : { refName: node.name }),
    // An ephemeral model is inlined into its callers and builds no relation.
    ...(materialization === "ephemeral"
      ? {}
      : { database: node.database, schema: node.schema }),
    layer: inferLayer(
      { tags: node.tags, path: node.original_file_path, name: node.name },
      options.layer,
    ),
  };
}
