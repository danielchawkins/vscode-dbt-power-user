import * as path from "node:path";

import type { ManifestProject } from "./manifestProject";
import type { ManifestResources, SourceMetaMap } from "./types";
import { RESOURCE_TYPE_SOURCE } from "./types";

import type { Log } from "../log";

export class SourceParser {
  private terminal: Pick<Log, "debug">;

  constructor(terminal: Pick<Log, "debug">) {
    this.terminal = terminal;
  }

  createSourceMetaMap(
    sourcesMap: ManifestResources,
    project: ManifestProject,
  ): Promise<SourceMetaMap> {
    return new Promise((resolve) => {
      const projectRoot = project.getProjectRoot();
      const projectName = project.getProjectName();
      this.terminal.debug(
        "SourceParser",
        `Parsing sources for "${projectName}" at ${projectRoot}`,
      );
      const sourceMetaMap: SourceMetaMap = new Map();
      if (sourcesMap === null || sourcesMap === undefined) {
        resolve(sourceMetaMap);
      }
      // TODO: these things can change so we should recreate them if project config changes
      const packagePath = project.getPackageInstallPath();
      if (packagePath === undefined) {
        throw new Error("packagePath is not defined in " + projectRoot);
      }
      Object.values(sourcesMap)
        .filter((source) => source.resource_type === RESOURCE_TYPE_SOURCE)
        .reduce(
          (
            previousValue: SourceMetaMap,
            {
              source_name,
              database,
              schema,
              name,
              original_file_path,
              unique_id,
              description,
              columns,
              identifier,
              package_name,
              meta,
            },
          ) => {
            if (!source_name) {
              return previousValue;
            }
            let source = previousValue.get(source_name);
            if (!source) {
              source = {
                tables: [],
                unique_id,
                name: source_name,
                database: database,
                schema: schema,
                package_name,
                meta: meta,
              };
              previousValue.set(source_name, source);
            }
            const fullPath = path.join(projectRoot, original_file_path);
            source.tables.push({
              name,
              identifier,
              database,
              schema,
              path: fullPath,
              description: description,
              columns: columns,
            });
            return previousValue;
          },
          sourceMetaMap,
        );
      this.terminal.debug(
        "SourceParser",
        `Returning sources for "${project.getProjectName()}" at ${projectRoot}`,
        sourceMetaMap,
      );
      resolve(sourceMetaMap);
    });
  }
}
