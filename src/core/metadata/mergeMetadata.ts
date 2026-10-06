import type { Log } from "../log";
import { GraphParser, type DBTGraphType } from "../manifest";
import type {
  DocMetaMap,
  ExposureMetaMap,
  FunctionMetaMap,
  GraphMetaMap,
  MacroMetaMap,
  MetricMetaMap,
  NodeData,
  NodeGraphMap,
  NodeMetaData,
  NodeMetaMap,
  NodeResourceType,
  SemanticModelMetaMap,
  SourceMetaMap,
  TestMetaMap,
  UnitTestMetaMap,
} from "../manifest/types";
import {
  ADDED_TYPES,
  REPLACED_TYPES,
  SERVER_GRAPH_TYPES,
  SERVER_PARENT_KEY_TYPES,
} from "./fieldOwners";
import { createModelDepthsMap } from "./modelDepth";
import type { ServerMetadata, ServerNode } from "./serverMetadata";

/** The maps consumers read; `ParsedManifest` has the same shape. */
export interface MergeableManifest {
  nodeMetaMap: NodeMetaMap;
  macroMetaMap: MacroMetaMap;
  metricMetaMap: MetricMetaMap;
  sourceMetaMap: SourceMetaMap;
  graphMetaMap: GraphMetaMap;
  testMetaMap: TestMetaMap;
  unitTestMetaMap: UnitTestMetaMap;
  docMetaMap: DocMetaMap;
  exposureMetaMap: ExposureMetaMap;
  functionMetaMap: FunctionMetaMap;
  semanticModelMetaMap: SemanticModelMetaMap;
  modelDepthMap: Map<string, number>;
}

const quiet: Pick<Log, "debug"> = { debug: () => undefined };

/** Node kinds the graph holds: the server's, plus the parse's `analysis` and `semantic_model`. */
const GRAPH_TYPES = new Set([
  ...SERVER_GRAPH_TYPES,
  "analysis",
  "semantic_model",
]);

/** Node kinds that have a key in `graphMetaMap.parents`; sources and unit tests do not. */
const PARENT_KEY_TYPES = new Set([
  ...SERVER_PARENT_KEY_TYPES,
  "analysis",
  "semantic_model",
]);

const typeOf = (uniqueId: string): string => uniqueId.split(".")[0] ?? "";

/**
 * A manifest with nothing in it, for a project that has not been parsed yet.
 * @internal
 */
export function emptyParsedManifest(): MergeableManifest {
  const emptyNodes: NodeMetaMap = {
    lookupByBaseName: () => undefined,
    lookupByUniqueId: () => undefined,
    nodes: () => [],
  };
  return {
    nodeMetaMap: emptyNodes,
    macroMetaMap: new Map(),
    metricMetaMap: new Map(),
    sourceMetaMap: new Map(),
    graphMetaMap: {
      parents: new Map(),
      children: new Map(),
      tests: new Map(),
      metrics: new Map(),
    },
    testMetaMap: new Map(),
    unitTestMetaMap: new Map(),
    docMetaMap: new Map(),
    exposureMetaMap: new Map(),
    functionMetaMap: new Map(),
    semanticModelMetaMap: new Map(),
    modelDepthMap: new Map(),
  };
}

export interface MergeOptions {
  /** The absolute path of a server node's file, when it has one. */
  pathOf?: (node: ServerNode) => string | undefined;
}

/**
 * The manifest consumers read: server-owned fields from `server` where it has a value, the rest from `parse`.
 * Without a server value the graph fields stay empty: the parse supplies only tests, metrics, the constraint
 * overlay and the parents of kinds the server does not list.
 */
export function mergeMetadata(
  server: ServerMetadata | undefined,
  parse: MergeableManifest | undefined,
  options: MergeOptions = {},
): MergeableManifest {
  const base = parse ?? emptyParsedManifest();
  if (!server) {
    return base;
  }
  const serverNodes = new Map(server.nodes.map((n) => [n.uniqueId, n]));
  const nodeMetaMap = mergeNodeMetaMap(
    base.nodeMetaMap,
    serverNodes,
    server,
    options,
  );
  const parentIds = mergedParentIds(
    base.graphMetaMap,
    removedIds(base.nodeMetaMap, serverNodes, server),
    serverNodes,
  );
  const childIds = invert(parentIds);
  const graph = graphFrom(base, nodeMetaMap, serverNodes, parentIds, childIds);
  return {
    ...base,
    nodeMetaMap,
    graphMetaMap: { ...base.graphMetaMap, ...graph },
    modelDepthMap: depths(nodeMetaMap, parentIds, childIds),
  };
}

function mergeNodeMetaMap(
  parse: NodeMetaMap,
  serverNodes: ReadonlyMap<string, ServerNode>,
  server: ServerMetadata,
  options: MergeOptions,
): NodeMetaMap {
  const removed = removedIds(parse, serverNodes, server);
  const added = new Map<string, NodeMetaData>();
  for (const node of serverNodes.values()) {
    if (
      ADDED_TYPES.has(node.resourceType) &&
      !parse.lookupByUniqueId(node.uniqueId)
    ) {
      added.set(node.uniqueId, identityOnly(node, options.pathOf?.(node)));
    }
  }
  return {
    lookupByUniqueId: (id) =>
      removed.has(id)
        ? undefined
        : (added.get(id) ?? parse.lookupByUniqueId(id)),
    lookupByBaseName: (name, type?: NodeResourceType) => {
      const hit = parse.lookupByBaseName(name, type);
      if (hit && !removed.has(hit.unique_id)) {
        return hit;
      }
      return [...added.values()].find(
        (node) =>
          node.name === name &&
          (type === undefined || node.resource_type === type),
      );
    },
    nodes: () => [
      ...[...parse.nodes()].filter((n) => !removed.has(n.unique_id)),
      ...added.values(),
    ],
  };
}

/**
 * Parse nodes of the root package that the server no longer lists. `+package:<root>` lists the root package and its
 * ancestors only, so nodes of other packages are never dropped.
 */
function removedIds(
  parse: NodeMetaMap,
  serverNodes: ReadonlyMap<string, ServerNode>,
  server: ServerMetadata,
): Set<string> {
  const removed = new Set<string>();
  const rootPackage = server.rootPackage;
  for (const node of parse.nodes()) {
    if (
      REPLACED_TYPES.has(node.resource_type) &&
      node.package_name === rootPackage &&
      !serverNodes.has(node.unique_id)
    ) {
      removed.add(node.unique_id);
    }
  }
  return removed;
}

function identityOnly(
  node: ServerNode,
  path: string | undefined,
): NodeMetaData {
  return {
    unique_id: node.uniqueId,
    path,
    database: "",
    schema: "",
    alias: node.name,
    name: node.name,
    package_name: node.packageName,
    description: "",
    patch_path: "",
    columns: {},
    config: { materialized: node.materialized ?? "" },
    resource_type: node.resourceType,
    depends_on: {
      macros: [] as unknown as [string],
      nodes: node.dependsOn as unknown as [string],
      sources: [] as unknown as [string],
    },
    compiled_path: "",
    meta: {},
  };
}

/** `child -> parents` for every graph key: the server's edges for its nodes, the parse's for the rest. */
function mergedParentIds(
  parse: GraphMetaMap,
  removed: ReadonlySet<string>,
  serverNodes: ReadonlyMap<string, ServerNode>,
): DBTGraphType {
  const parents: DBTGraphType = {};
  for (const [id, entry] of parse.parents) {
    if (!removed.has(id) && !serverNodes.has(id)) {
      parents[id] = entry.nodes.map((n) => n.key);
    }
  }
  for (const node of serverNodes.values()) {
    if (PARENT_KEY_TYPES.has(node.resourceType)) {
      parents[node.uniqueId] = node.dependsOn;
    }
  }
  const alive = (id: string): boolean => !removed.has(id);
  for (const [id, ids] of Object.entries(parents)) {
    parents[id] = ids.filter(alive);
  }
  return parents;
}

function invert(parents: DBTGraphType): DBTGraphType {
  const children: DBTGraphType = {};
  for (const [child, ids] of Object.entries(parents)) {
    for (const parent of ids) {
      (children[parent] ??= []).push(child);
    }
  }
  return children;
}

function graphFrom(
  base: MergeableManifest,
  nodeMetaMap: NodeMetaMap,
  serverNodes: ReadonlyMap<string, ServerNode>,
  parentIds: DBTGraphType,
  childIds: DBTGraphType,
): Pick<GraphMetaMap, "parents" | "children"> {
  const resolve = new GraphParser(quiet).mapToNode(
    base.sourceMetaMap,
    nodeMetaMap,
    base.testMetaMap,
    base.functionMetaMap,
  );
  const previous = new Map<string, NodeData>();
  for (const map of [base.graphMetaMap.parents, base.graphMetaMap.children]) {
    for (const entry of map.values()) {
      entry.nodes.forEach((n) => previous.set(n.key, n));
    }
  }
  const constraintEdges = constraintEdgeKeys(base.graphMetaMap);
  const nodeData = (id: string): NodeData | undefined => {
    const type = typeOf(id);
    if (!GRAPH_TYPES.has(type)) {
      return undefined;
    }
    return (
      resolve(id) ??
      previous.get(id) ?? {
        label: serverNodes.get(id)?.name ?? id,
        key: id,
        resourceType: type,
      }
    );
  };
  const edgeType = (child: string, parent: string) =>
    constraintEdges.has(`${child}\0${parent}`) ? "constraint" : "data";
  const parents: NodeGraphMap = new Map();
  for (const [child, ids] of Object.entries(parentIds)) {
    parents.set(child, {
      nodes: ids.flatMap((id) => {
        const node = nodeData(id);
        return node ? [{ ...node, edgeType: edgeType(child, id) }] : [];
      }),
    } as never);
  }
  const children: NodeGraphMap = new Map();
  for (const [parent, ids] of Object.entries(childIds)) {
    children.set(parent, {
      nodes: ids
        .filter((id) => typeOf(id) !== "test")
        .flatMap((id) => {
          const node = nodeData(id);
          return node ? [{ ...node, edgeType: edgeType(id, parent) }] : [];
        }),
    } as never);
  }
  return { parents, children };
}

/** The `child\0parent` edges the parse marked as constraint-only. */
function constraintEdgeKeys(graph: GraphMetaMap): Set<string> {
  const keys = new Set<string>();
  for (const [child, entry] of graph.parents) {
    for (const node of entry.nodes) {
      if (node.edgeType === "constraint") {
        keys.add(`${child}\0${node.key}`);
      }
    }
  }
  return keys;
}

function depths(
  nodeMetaMap: NodeMetaMap,
  parents: DBTGraphType,
  children: DBTGraphType,
): Map<string, number> {
  const models: Record<string, { resource_type: string; name: string }> = {};
  for (const node of nodeMetaMap.nodes()) {
    if (node.resource_type === "model") {
      models[node.unique_id] = { resource_type: "model", name: node.name };
    }
  }
  return createModelDepthsMap(models, parents, children);
}
