import type { ListNodesResult, ProjectInfo } from "../lsp";
import { SERVER_RESOURCE_TYPES } from "./fieldOwners";

/** One node of a `dbt.listNodes` project-grain result, restricted to the fields the merge reads. */
export interface ServerNode {
  uniqueId: string;
  name: string;
  resourceType: string;
  packageName: string;
  originalFilePath: string;
  materialized: string | undefined;
  dependsOn: string[];
}

/** What the Server Producer knows about a project. */
export interface ServerMetadata {
  nodes: ServerNode[];
  info: ProjectInfo | undefined;
  /** The package the listing was requested for; parse nodes of other packages are never dropped. */
  rootPackage: string | undefined;
  /** Equal for equal node sets and project info, so an unchanged refresh publishes nothing. */
  signature: string;
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

function toServerNode(raw: unknown): ServerNode | undefined {
  const node = raw as Record<string, unknown> | null;
  const uniqueId = text(node?.unique_id);
  const resourceType = text(node?.resource_type);
  if (!node || !uniqueId || !resourceType) {
    return undefined;
  }
  const config = node.config as { materialized?: unknown } | null | undefined;
  const dependsOn = (node.depends_on as { nodes?: unknown } | null)?.nodes;
  return {
    uniqueId,
    name: text(node.name) ?? uniqueId.split(".").slice(2).join("."),
    resourceType,
    packageName: text(node.package_name) ?? "",
    originalFilePath: text(node.original_file_path) ?? "",
    materialized: text(config?.materialized),
    dependsOn: Array.isArray(dependsOn)
      ? dependsOn.filter((id): id is string => typeof id === "string")
      : [],
  };
}

/** The server-owned resource types of a `["+package:<root>"]` result; other node kinds are the parse's. */
export function serverMetadataFrom(
  result: ListNodesResult,
  info: ProjectInfo | undefined,
  rootPackage: string | undefined = info?.projectName,
): ServerMetadata {
  const nodes = (result.nodes ?? [])
    .map(toServerNode)
    .filter(
      (node): node is ServerNode =>
        node !== undefined && SERVER_RESOURCE_TYPES.has(node.resourceType),
    );
  const signature = JSON.stringify([
    [...nodes].sort((a, b) => a.uniqueId.localeCompare(b.uniqueId)),
    info ?? null,
  ]);
  return { nodes, info, rootPackage, signature };
}
