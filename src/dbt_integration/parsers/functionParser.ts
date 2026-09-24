import * as path from "path";

import { FunctionMetaMap, RESOURCE_TYPE_FUNCTION } from "../domain";
import { ManifestProject } from "../manifestProject";
import { DBTTerminal } from "../terminal";

export class FunctionParser {
  constructor(private terminal: DBTTerminal) {}

  createFunctionMetaMap(
    functionsMap: any[],
    project: ManifestProject,
  ): Promise<FunctionMetaMap> {
    return new Promise((resolve) => {
      const projectRoot = project.getProjectRoot();
      const projectName = project.getProjectName();
      this.terminal.debug(
        "FunctionParser",
        `Parsing functions for "${projectName}" at ${projectRoot}`,
      );
      const functionMetaMap: FunctionMetaMap = new Map();
      if (functionsMap === null || functionsMap === undefined) {
        resolve(functionMetaMap);
        return;
      }
      Object.values(functionsMap)
        .filter((fn) => fn.resource_type === RESOURCE_TYPE_FUNCTION)
        .forEach((fn) => {
          const fullPath = fn.original_file_path
            ? path.join(projectRoot, fn.original_file_path)
            : undefined;
          functionMetaMap.set(fn.name, { ...fn, path: fullPath });
        });
      this.terminal.debug(
        "FunctionParser",
        `Returning functions for "${projectName}" at ${projectRoot}`,
        functionMetaMap,
      );
      resolve(functionMetaMap);
    });
  }
}
