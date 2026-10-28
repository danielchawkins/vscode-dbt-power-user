import * as path from "node:path";

import type { Log } from "../log";
import type { ManifestProject } from "./manifestProject";
import type {
  FunctionMetaMap,
  FunctionResource,
  ManifestResources,
} from "./types";
import { RESOURCE_TYPE_FUNCTION } from "./types";

export class FunctionParser {
  private terminal: Pick<Log, "debug">;

  constructor(terminal: Pick<Log, "debug">) {
    this.terminal = terminal;
  }

  createFunctionMetaMap(
    functionsMap: ManifestResources<FunctionResource>,
    project: ManifestProject,
  ): Promise<FunctionMetaMap> {
    return new Promise((resolve) => {
      const projectRoot = project.root.fsPath;
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
