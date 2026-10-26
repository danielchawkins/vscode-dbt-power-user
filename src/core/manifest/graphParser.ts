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
  SemanticModelMetaMap,
  SourceMetaMap,
  TestMetaMap,
  UnitTestMetaMap,
} from "./types";
import { RESOURCE_TYPE_METRIC, RESOURCE_TYPE_TEST } from "./types";

const notEmpty = <T>(value: T | null | undefined): value is T => {
  return value !== null && value !== undefined;
};

export type DBTGraphType = {
  [name: string]: string[];
};

function withEdgeType(node: NodeData, isConstraintOnly: boolean): NodeData {
  return { ...node, edgeType: isConstraintOnly ? "constraint" : "data" };
}

/** Node kinds the server does not list, so their `depends_on` edges stay with the parse. */
const PARSE_GRAPH_TYPES = new Set(["analysis"]);

/** For each node, its neighbours in `graph` that are of `resourceType`. */
function graphOfType(
  graph: DBTGraphType,
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
  parentMetaMap: DBTGraphType;
  childMetaMap: DBTGraphType;
  constraintOnlyParents: DBTGraphType;
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
    const projectRoot = project.getProjectRoot();
    const projectName = project.getProjectName();
    this.terminal.debug(
      "GraphParser",
      `Parsing graph for "${projectName}" at ${projectRoot}`,
    );

    const resolve = this.mapToNode(
      sourceMetaMap,
      nodeMetaMap,
      testMetaMap,
      functionMetaMap,
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
    const metrics = graphOfType(childrenMap, resolve, RESOURCE_TYPE_METRIC);

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

  mapToNode(
    sourceMetaMap: SourceMetaMap,
    nodeMetaMap: NodeMetaMap,
    testMetaMap: TestMetaMap,
    functionMetaMap: FunctionMetaMap,
  ): (parentNodeName: string) => NodeData | undefined {
    return (parentNodeName) => {
      // Support dots in model names
      const [nodeType, _nodePackage, ...restNodeName] =
        parentNodeName.split(".");
      const nodeName = restNodeName.join(".");
      switch (nodeType) {
        case "source": {
          const [sourceName, tableName] = nodeName.split(".");
          const url = sourceMetaMap
            .get(sourceName ?? "")
            ?.tables.find((table) => table.name === tableName)?.path;
          return {
            label: `${tableName} (${sourceName})`,
            key: parentNodeName,
            url: url,
            resourceType: "source",
          };
        }
        case "model": {
          // can this ever be not there?
          const model = nodeMetaMap.lookupByUniqueId(parentNodeName);
          if (!model) {
            return;
          }
          const url = model.path;
          return {
            label: model.alias,
            key: parentNodeName,
            url: url,
            resourceType: "model",
          };
        }
        case "seed": {
          // can this ever be not there?
          const model = nodeMetaMap.lookupByUniqueId(parentNodeName);
          if (!model) {
            return;
          }
          const url = model.path;
          return {
            label: model.alias,
            key: parentNodeName,
            url: url,
            resourceType: "seed",
          };
        }
        case "test": {
          // nodeName => more interesting label possibilities?
          const url = testMetaMap.get(nodeName.split(".")[0] ?? "")?.path;
          return {
            label: nodeName,
            key: parentNodeName,
            url: url,
            resourceType: "test",
          };
        }
        case "analysis": {
          const url = nodeMetaMap.lookupByBaseName(nodeName, "analysis")?.path;
          return {
            label: nodeName,
            key: parentNodeName,
            url: url,
            resourceType: "analysis",
          };
        }
        case "snapshot": {
          const url = nodeMetaMap.lookupByBaseName(nodeName, "snapshot")?.path;
          return {
            label: nodeName,
            key: parentNodeName,
            url: url,
            resourceType: "snapshot",
          };
        }
        case "exposure": {
          const url = nodeMetaMap.lookupByBaseName(nodeName)?.path;
          return {
            label: nodeName,
            key: parentNodeName,
            url: url,
            resourceType: "exposure",
          };
        }
        case "semantic_model": {
          return {
            label: nodeName,
            key: parentNodeName,
            resourceType: "semantic_model",
          };
        }
        case "function": {
          const url = functionMetaMap.get(nodeName)?.path;
          return {
            label: nodeName,
            key: parentNodeName,
            url: url,
            resourceType: "function",
          };
        }
        case undefined:
        default:
          this.terminal.debug(
            "GraphParser",
            `Node type '${nodeType}' not implemented`,
          );
          return undefined;
      }
    };
  }
}
