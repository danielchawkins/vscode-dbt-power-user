import {
  FunctionMetaMap,
  GraphMetaMap,
  NodeData,
  NodeGraphMap,
  NodeMetaMap,
  RESOURCE_TYPE_METRIC,
  RESOURCE_TYPE_TEST,
  SourceMetaMap,
  TestMetaMap,
} from "../domain";
import { ManifestProject } from "../manifestProject";
import { DBTTerminal } from "../terminal";

const notEmpty = <T>(value: T | null | undefined): value is T => {
  return value !== null && value !== undefined;
};

export type DBTGraphType = {
  [name: string]: string[];
};

// Encodes a directed `child -> parent` edge as a single Set key.
const EDGE_SEP = "\u0000";
function edgeKey(child: string, parent: string): string {
  return `${child}${EDGE_SEP}${parent}`;
}

function withEdgeType(node: NodeData, isConstraintOnly: boolean): NodeData {
  return { ...node, edgeType: isConstraintOnly ? "constraint" : "data" };
}

export class GraphParser {
  constructor(private terminal: DBTTerminal) {}

  createGraphMetaMap(
    project: ManifestProject,
    parentMap: DBTGraphType,
    childrenMap: DBTGraphType,
    nodeMetaMap: NodeMetaMap,
    sourceMetaMap: SourceMetaMap,
    testMetaMap: TestMetaMap,
    functionMetaMap: FunctionMetaMap,
    constraintOnlyParents: DBTGraphType = {},
  ): GraphMetaMap {
    const projectRoot = project.getProjectRoot();
    const projectName = project.getProjectName();
    this.terminal.debug(
      "GraphParser",
      `Parsing graph for "${projectName}" at ${projectRoot}`,
    );

    // Edges (`child` -> `parent`) that exist only because of a FK constraint.
    // Used to stamp `edgeType` so data-flow consumers can hide/style them without
    // removing them from the dependency graph (build order / depth / impact stay intact).
    const constraintEdges = new Set<string>();
    Object.entries(constraintOnlyParents).forEach(([child, parents]) => {
      parents.forEach((parent) => constraintEdges.add(edgeKey(child, parent)));
    });

    const parents: NodeGraphMap = Object.entries(parentMap).reduce(
      (map, [nodeName, nodes]) => {
        const currentNodes = nodes
          .map(
            this.mapToNode(
              sourceMetaMap,
              nodeMetaMap,
              testMetaMap,
              functionMetaMap,
            ),
          )
          .filter(notEmpty)
          .map((node) =>
            withEdgeType(
              node,
              constraintEdges.has(edgeKey(nodeName, node.key)),
            ),
          );
        map.set(nodeName, { nodes: currentNodes });
        return map;
      },
      new Map(),
    );

    const children: NodeGraphMap = Object.entries(childrenMap).reduce(
      (map, [nodeName, nodes]) => {
        const currentNodes = nodes
          .map(
            this.mapToNode(
              sourceMetaMap,
              nodeMetaMap,
              testMetaMap,
              functionMetaMap,
            ),
          )
          .filter((n) => n?.resourceType !== RESOURCE_TYPE_TEST)
          .filter(notEmpty)
          .map((node) =>
            withEdgeType(
              node,
              constraintEdges.has(edgeKey(node.key, nodeName)),
            ),
          );
        map.set(nodeName, { nodes: currentNodes });
        return map;
      },
      new Map(),
    );

    const tests: NodeGraphMap = Object.entries(childrenMap).reduce(
      (map, [nodeName, nodes]) => {
        const currentNodes = nodes
          .map(
            this.mapToNode(
              sourceMetaMap,
              nodeMetaMap,
              testMetaMap,
              functionMetaMap,
            ),
          )
          .filter((n) => n?.resourceType === RESOURCE_TYPE_TEST)
          .filter(notEmpty);
        map.set(nodeName, { nodes: currentNodes });
        return map;
      },
      new Map(),
    );

    const metrics: NodeGraphMap = Object.entries(childrenMap).reduce(
      (map, [nodeName, nodes]) => {
        const currentNodes = nodes
          .map(
            this.mapToNode(
              sourceMetaMap,
              nodeMetaMap,
              testMetaMap,
              functionMetaMap,
            ),
          )
          .filter((n) => n?.resourceType === RESOURCE_TYPE_METRIC)
          .filter(notEmpty);
        map.set(nodeName, { nodes: currentNodes });
        return map;
      },
      new Map(),
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
            .get(sourceName)
            ?.tables.find((table) => table.name === tableName)?.path!;
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
          const url = model?.path!;
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
          const url = model?.path!;
          return {
            label: model.alias,
            key: parentNodeName,
            url: url,
            resourceType: "seed",
          };
        }
        case "test": {
          // nodeName => more interesting label possibilities?
          // console.log(`${nodeName} => (parent: ${parentNodeName})`);
          const url = testMetaMap.get(nodeName.split(".")[0])?.path;
          return {
            label: nodeName,
            key: parentNodeName,
            url: url,
            resourceType: "test",
          };
        }
        case "analysis": {
          const url = nodeMetaMap.lookupByBaseName(nodeName, "analysis")?.path!;
          return {
            label: nodeName,
            key: parentNodeName,
            url: url,
            resourceType: "analysis",
          };
        }
        case "snapshot": {
          const url = nodeMetaMap.lookupByBaseName(nodeName, "snapshot")?.path!;
          return {
            label: nodeName,
            key: parentNodeName,
            url: url,
            resourceType: "snapshot",
          };
        }
        case "exposure": {
          const url = nodeMetaMap.lookupByBaseName(nodeName)?.path!;
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
        default:
          console.log(`Node Type '${nodeType}' not implemented!`);
          return undefined;
      }
    };
  }
}
