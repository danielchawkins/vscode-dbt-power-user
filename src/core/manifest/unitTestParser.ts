import * as path from "path";

import type { Log } from "../log";
import { ManifestProject } from "./manifestProject";
import { RESOURCE_TYPE_UNIT_TEST, UnitTestMetaMap } from "./types";

export class UnitTestParser {
  constructor(private terminal: Pick<Log, "debug">) {}

  createUnitTestMetaMap(
    nodesMap: Record<string, any>,
    project: ManifestProject,
  ): Promise<UnitTestMetaMap> {
    return new Promise((resolve) => {
      const projectRoot = project.getProjectRoot();
      const projectName = project.getProjectName();
      this.terminal.debug(
        "UnitTestParser",
        `Parsing unit tests for "${projectName}" at ${projectRoot}`,
      );
      const unitTestMetaMap: UnitTestMetaMap = new Map();
      if (nodesMap === null || nodesMap === undefined) {
        resolve(unitTestMetaMap);
        return;
      }
      Object.values(nodesMap)
        .filter((node: any) => node.resource_type === RESOURCE_TYPE_UNIT_TEST)
        .forEach(({ name, original_file_path, model, unique_id }: any) => {
          const fullPath = original_file_path
            ? path.join(projectRoot, original_file_path)
            : undefined;
          unitTestMetaMap.set(unique_id, {
            name,
            path: fullPath,
            original_file_path,
            model,
            unique_id,
          });
        });
      this.terminal.debug(
        "UnitTestParser",
        `Returning unit tests for "${projectName}" at ${projectRoot}`,
        unitTestMetaMap,
      );
      resolve(unitTestMetaMap);
    });
  }
}
