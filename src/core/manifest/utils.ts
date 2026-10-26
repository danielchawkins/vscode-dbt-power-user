import { existsSync } from "node:fs";
import * as path from "node:path";

import type { ManifestProject } from "./manifestProject";

export interface ResourcePaths {
  /** Absolute path of a file inside `packageName`, or `undefined` when it is not on disk. */
  fileOf(packageName: string, relativePath: string): string | undefined;
}

/**
 * Resolves resource files for a project. Throws when the package install path is unknown,
 * so a parser rejects instead of hanging.
 */
export function resourcePaths(project: ManifestProject): ResourcePaths {
  const projectName = project.getProjectName();
  const projectRoot = project.getProjectRoot();
  const packagePath = project.paths()?.packagesInstallPath;
  if (packagePath === undefined) {
    throw new Error(`packagePath is not defined in ${projectRoot}`);
  }
  return {
    fileOf: (packageName, relativePath) => {
      if (packageName === projectName) {
        return path.join(projectRoot, relativePath);
      }
      const installed = path.join(packagePath, packageName, relativePath);
      return existsSync(installed) ? installed : undefined;
    },
  };
}

export function escapeRegex(s: string): string {
  return s.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Index of the first line of `text` that reads `keyword name`, or `undefined`.
 * `name` is matched literally, so pass a trailing `(` to require a call.
 */
export function findDeclarationLine(
  text: string,
  keyword: string,
  name: string,
): number | undefined {
  const declaration = new RegExp(
    `${escapeRegex(keyword)}\\s${escapeRegex(name)}`,
  );
  const index = text.split("\n").findIndex((line) => declaration.test(line));
  return index === -1 ? undefined : index;
}
