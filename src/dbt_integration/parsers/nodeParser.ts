import * as path from "path";

import {
  NodeMetaData,
  NodeMetaMap,
  NodeResourceType,
  RESOURCE_TYPE_ANALYSIS,
  RESOURCE_TYPE_MODEL,
  RESOURCE_TYPE_SEED,
  RESOURCE_TYPE_SNAPSHOT,
  isResourceNode,
} from "../domain";
import { ManifestProject } from "../manifestProject";
import { DBTTerminal } from "../terminal";

import {
  createFullPathForNode,
  getExternalProjectNamesFromDbtLoomConfig,
} from "./utils";

// Priority order for the model-preferred fallback when `lookupByBaseName` is
// called without an explicit `resourceType`. Models take precedence so a
// collision between `models/orders.sql` and `snapshots/orders.sql` always
// resolves to the model. Non-colliding non-models remain reachable at the
// default call site to preserve pre-#1706 semantics for callers that just
// want "whatever resource has this name" (e.g. `ref()` go-to-definition on a
// seed).
const RESOURCE_TYPE_FALLBACK_ORDER: readonly NodeResourceType[] = [
  RESOURCE_TYPE_MODEL,
  RESOURCE_TYPE_SEED,
  RESOURCE_TYPE_ANALYSIS,
  RESOURCE_TYPE_SNAPSHOT,
];

export class NodeMetaMapImpl implements NodeMetaMap {
  constructor(
    private latestVersionLookupMap: Map<string, string> = new Map(),
    // Bare-name lookups are partitioned by resource_type so that a model and a
    // snapshot (or seed, analysis) sharing a filename — e.g. `models/orders.sql`
    // and `snapshots/orders.sql` — occupy separate slots and are each reachable
    // via `lookupByBaseName(name, resourceType)`. See
    // AltimateAI/vscode-dbt-power-user#1706.
    private nameLookupMapsByType: Map<
      NodeResourceType,
      Map<string, string>
    > = new Map(),
    private modelMetadataLookupMap: Map<string, NodeMetaData> = new Map(),
  ) {}

  lookupByBaseName(
    modelBaseName: string,
    resourceType?: NodeResourceType,
  ): NodeMetaData | undefined {
    if (resourceType !== undefined) {
      return this.lookupInType(modelBaseName, resourceType);
    }
    for (const type of RESOURCE_TYPE_FALLBACK_ORDER) {
      const hit = this.lookupInType(modelBaseName, type);
      if (hit) {
        return hit;
      }
    }
    return undefined;
  }

  private lookupInType(
    modelBaseName: string,
    resourceType: NodeResourceType,
  ): NodeMetaData | undefined {
    const nameMap = this.nameLookupMapsByType.get(resourceType);
    if (!nameMap) {
      return undefined;
    }
    const uniqueId = nameMap.get(modelBaseName);
    if (!uniqueId) {
      return undefined;
    }
    return this.lookupByUniqueId(uniqueId);
  }

  lookupByUniqueId(uniqueId: string): NodeMetaData | undefined {
    const latestVersionUniqueID = this.latestVersionLookupMap.get(uniqueId);
    if (latestVersionUniqueID) {
      return this.modelMetadataLookupMap.get(latestVersionUniqueID);
    }
    return this.modelMetadataLookupMap.get(uniqueId);
  }

  nodes(): Iterable<NodeMetaData> {
    return this.modelMetadataLookupMap.values();
  }
}

export class NodeParser {
  constructor(private terminal: DBTTerminal) {}

  createNodeMetaMap(
    nodesMap: any[],
    project: ManifestProject,
  ): Promise<NodeMetaMap> {
    return new Promise(async (resolve) => {
      const projectRoot = project.getProjectRoot();
      const projectName = project.getProjectName();
      this.terminal.debug(
        "NodeParser",
        `Parsing nodes for "${projectName}" at ${projectRoot}`,
      );
      const latestVersionLookupMap: Map<string, string> = new Map();
      const modelMetadataLookupMap: Map<string, NodeMetaData> = new Map();
      const nameLookupMapsByType: Map<
        NodeResourceType,
        Map<string, string>
      > = new Map();
      if (nodesMap === null || nodesMap === undefined) {
        resolve(new NodeMetaMapImpl(new Map(), new Map()));
      }
      const nodesMaps = Object.values(nodesMap).filter((model) =>
        isResourceNode(model.resource_type),
      );
      const packagePath = project.getPackageInstallPath();
      if (packagePath === undefined) {
        throw new Error("packagePath is not defined " + projectRoot);
      }
      const externalProjectNames =
        getExternalProjectNamesFromDbtLoomConfig(projectRoot);
      for (const nodesMap of nodesMaps) {
        const {
          name,
          original_file_path,
          database,
          schema,
          alias,
          package_name,
          latest_version,
          version,
          unique_id,
          columns,
          description,
          patch_path,
          config,
          resource_type,
          depends_on,
          meta,
          constraints,
          relation_name,
        } = nodesMap;
        const fullPath = createFullPathForNode(
          projectName,
          projectRoot,
          package_name,
          packagePath,
          original_file_path,
        );
        const targetPath = project.getTargetPath();
        if (fullPath) {
          const nodeResourceType = resource_type as NodeResourceType;
          let nameMap = nameLookupMapsByType.get(nodeResourceType);
          if (!nameMap) {
            nameMap = new Map<string, string>();
            nameLookupMapsByType.set(nodeResourceType, nameMap);
          }
          nameMap.set(path.parse(fullPath).name, unique_id);
        }
        if (version && latest_version && version === latest_version) {
          const parts = unique_id.split(".");
          parts.pop();
          latestVersionLookupMap.set(parts.join("."), unique_id);
        }
        modelMetadataLookupMap.set(unique_id, {
          path: fullPath,
          database,
          schema,
          alias,
          name,
          package_name,
          unique_id,
          columns,
          description,
          patch_path,
          config,
          resource_type,
          depends_on,
          is_external_project: Boolean(
            externalProjectNames?.includes(package_name),
          ),
          compiled_path: targetPath
            ? path.join(
                targetPath,
                "compiled",
                package_name,
                original_file_path,
              )
            : "",
          meta: meta,
          constraints,
          relation_name,
        });
      }
      this.terminal.debug(
        "NodeParser",
        `Returning nodes for "${projectName}" at ${projectRoot}`,
        nameLookupMapsByType,
        modelMetadataLookupMap,
      );
      const nodeMetaMap: NodeMetaMap = new NodeMetaMapImpl(
        latestVersionLookupMap,
        nameLookupMapsByType,
        modelMetadataLookupMap,
      );
      resolve(nodeMetaMap);
    });
  }
}
