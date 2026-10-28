import type { Log } from "../log";
import type { ManifestProject } from "./manifestProject";
import type {
  DocMetaMap,
  ExposureMetaMap,
  FunctionMetaMap,
  GraphMetaMap,
  MacroMetaMap,
  MetricMetaMap,
  NodeData,
  NodeGraphMap,
  NodeMetaMap,
  NodeResourceType,
  SemanticModelMetaMap,
  SourceMetaMap,
  TestMetaMap,
  UnitTestMetaMap,
} from "./types";
import { RESOURCE_TYPE_SEMANTIC_MODEL, RESOURCE_TYPE_TEST } from "./types";

const notEmpty = <T>(value: T | null | undefined): value is T => {
  return value !== null && value !== undefined;
};

export type DependencyGraph = {
  [name: string]: string[];
};

function withEdgeType(node: NodeData, isConstraintOnly: boolean): NodeData {
  return { ...node, edgeType: isConstraintOnly ? "constraint" : "data" };
}

/** Node kinds the server does not list, so their `depends_on` edges stay with the parse. */
const PARSE_GRAPH_TYPES = new Set(["analysis"]);

/** For each node, its neighbours in `graph` that are of `resourceType`. */
function graphOfType(
  graph: DependencyGraph,
  resolve: (name: string) => NodeData | undefined,
  resourceType: string,
): NodeGraphMap {
  const result: NodeGraphMap = new Map();
  for (const [nodeName, nodes] of Object.entries(graph)) {
    result.set(nodeName, {
      nodes: nodes
        .map(resolve)
        .filter((n) => n?.resourceType === resourceType)
        .filter(notEmpty),
    } as never);
  }
  return result;
}

/** The resource maps one manifest parse produces. */
export interface ParsedResourceMaps {
  parentMetaMap: DependencyGraph;
  childMetaMap: DependencyGraph;
  constraintOnlyParents: DependencyGraph;
  nodeMetaMap: NodeMetaMap;
  macroMetaMap: MacroMetaMap;
  metricMetaMap: MetricMetaMap;
  semanticModelMetaMap: SemanticModelMetaMap;
  sourceMetaMap: SourceMetaMap;
  testMetaMap: TestMetaMap;
  unitTestMetaMap: UnitTestMetaMap;
  docMetaMap: DocMetaMap;
  exposureMetaMap: ExposureMetaMap;
  functionMetaMap: FunctionMetaMap;
}

/** The parts of {@link ParsedResourceMaps} the graph is built from, with the project they belong to. */
export type GraphInput = Pick<
  ParsedResourceMaps,
  | "parentMetaMap"
  | "childMetaMap"
  | "constraintOnlyParents"
  | "nodeMetaMap"
  | "sourceMetaMap"
  | "testMetaMap"
  | "functionMetaMap"
> & { project: ManifestProject };

/** The manifest records a graph node's url and label come from. */
type NodeMaps = Pick<
  ParsedResourceMaps,
  "sourceMetaMap" | "nodeMetaMap" | "testMetaMap" | "functionMetaMap"
>;

/** What the manifest holds for a node: the file it is defined in and, for a model, its alias. */
interface NodeRecord {
  path?: string | undefined;
  alias?: string;
}

/** How one resource type becomes a graph node. */
interface NodeKind {
  /** The manifest record behind the node. `nodeName` has the type and package prefix removed. */
  lookup: (
    maps: NodeMaps,
    nodeName: string,
    uniqueId: string,
  ) => NodeRecord | undefined;
  label: (nodeName: string, record: NodeRecord | undefined) => string;
  /** Drops the node when its record is missing, rather than keeping it without a url. */
  requiresRecord?: boolean;
}

const labelFromName: NodeKind["label"] = (nodeName) => nodeName;
const labelFromAlias: NodeKind["label"] = (_nodeName, record) =>
  record?.alias ?? "";
const byUniqueId: NodeKind["lookup"] = (maps, _nodeName, uniqueId) =>
  maps.nodeMetaMap.lookupByUniqueId(uniqueId);
const byBaseName =
  (resourceType?: NodeResourceType): NodeKind["lookup"] =>
  (maps, nodeName) =>
    maps.nodeMetaMap.lookupByBaseName(nodeName, resourceType);

const NODE_KINDS = new Map<string, NodeKind>([
  [
    "source",
    {
      lookup: (maps, nodeName) => {
        const [sourceName, tableName] = nodeName.split(".");
        return maps.sourceMetaMap
          .get(sourceName ?? "")
          ?.tables.find((table) => table.name === tableName);
      },
      label: (nodeName) => {
        const [sourceName, tableName] = nodeName.split(".");
        return `${tableName} (${sourceName})`;
      },
    },
  ],
  [
    "model",
    { lookup: byUniqueId, label: labelFromAlias, requiresRecord: true },
  ],
  ["seed", { lookup: byUniqueId, label: labelFromAlias, requiresRecord: true }],
  [
    "test",
    {
      // nodeName => more interesting label possibilities?
      lookup: (maps, nodeName) =>
        maps.testMetaMap.get(nodeName.split(".")[0] ?? ""),
      label: labelFromName,
    },
  ],
  ["analysis", { lookup: byBaseName("analysis"), label: labelFromName }],
  ["snapshot", { lookup: byBaseName("snapshot"), label: labelFromName }],
  ["exposure", { lookup: byBaseName(), label: labelFromName }],
  ["semantic_model", { lookup: () => undefined, label: labelFromName }],
  [
    "function",
    {
      lookup: (maps, nodeName) => maps.functionMetaMap.get(nodeName),
      label: labelFromName,
    },
  ],
]);

/** Resolves a `unique_id` to the graph node it names; undefined when the node's type is not in the graph. */
export function nodeResolver(
  maps: NodeMaps,
  terminal: Pick<Log, "debug">,
): (parentNodeName: string) => NodeData | undefined {
  return (parentNodeName) => {
    // Support dots in model names
    const [nodeType, _nodePackage, ...restNodeName] = parentNodeName.split(".");
    const nodeName = restNodeName.join(".");
    const kind = NODE_KINDS.get(nodeType ?? "");
    if (!kind) {
      terminal.debug("GraphParser", `Node type '${nodeType}' not implemented`);
      return undefined;
    }
    const record = kind.lookup(maps, nodeName, parentNodeName);
    if (kind.requiresRecord && record === undefined) {
      return undefined;
    }
    return {
      label: kind.label(nodeName, record),
      key: parentNodeName,
      url: record?.path,
      resourceType: nodeType ?? "",
    };
  };
}

export class GraphParser {
  private terminal: Pick<Log, "debug">;

  constructor(terminal: Pick<Log, "debug">) {
    this.terminal = terminal;
  }

  /**
   * The parse-owned part of the graph: `tests`, `metrics`, the constraint overlay in `parents`, and the `parents`
   * of kinds the server does not list (`analysis`). The other edges of `parents` and `children` come from the
   * Server Producer.
   */
  createGraphMetaMap({
    project,
    parentMetaMap: parentMap,
    childMetaMap: childrenMap,
    constraintOnlyParents,
    nodeMetaMap,
    sourceMetaMap,
    testMetaMap,
    functionMetaMap,
  }: GraphInput): GraphMetaMap {
    const projectRoot = project.root.fsPath;
    const projectName = project.getProjectName();
    this.terminal.debug(
      "GraphParser",
      `Parsing graph for "${projectName}" at ${projectRoot}`,
    );

    const resolve = nodeResolver(
      { sourceMetaMap, nodeMetaMap, testMetaMap, functionMetaMap },
      this.terminal,
    );
    const parents: NodeGraphMap = new Map();
    Object.entries(parentMap)
      .filter(([child]) => PARSE_GRAPH_TYPES.has(child.split(".")[0] ?? ""))
      .forEach(([child, ids]) => {
        parents.set(child, {
          nodes: ids
            .map(resolve)
            .filter(notEmpty)
            .map((node) => withEdgeType(node, false)),
        } as never);
      });
    Object.entries(constraintOnlyParents).forEach(([child, ids]) => {
      parents.set(child, {
        nodes: ids
          .map(resolve)
          .filter(notEmpty)
          .map((node) => withEdgeType(node, true)),
      } as never);
    });
    const children: NodeGraphMap = new Map();

    const tests = graphOfType(childrenMap, resolve, RESOURCE_TYPE_TEST);
    const metrics = graphOfType(
      childrenMap,
      resolve,
      RESOURCE_TYPE_SEMANTIC_MODEL,
    );

    const graph = {
      parents,
      children,
      tests,
      metrics,
    };
    this.terminal.debug(
      "GraphParser",
      `Returning graph for "${projectName}" at ${projectRoot}`,
      graph,
    );
    return graph;
  }
}
