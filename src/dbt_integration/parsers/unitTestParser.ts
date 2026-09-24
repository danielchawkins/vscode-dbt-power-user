import * as path from "path";

import { RESOURCE_TYPE_UNIT_TEST, UnitTestMetaMap } from "../domain";
import { ManifestProject } from "../manifestProject";
import { DBTTerminal } from "../terminal";

export class UnitTestParser {
  constructor(private terminal: DBTTerminal) {}

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
