import { readFileSync } from "fs";

import { ManifestProject } from "./manifestProject";
import { DocMetaMap } from "./types";

import type { Log } from "../log";
import { createFullPathForNode } from "./utils";

export class DocParser {
  constructor(private terminal: Pick<Log, "debug">) {}

  async createDocMetaMap(
    docs: Record<string, any> | null | undefined,
    project: ManifestProject,
  ): Promise<DocMetaMap> {
    const projectRoot = project.getProjectRoot();
    const projectName = project.getProjectName();
    this.terminal.debug(
      "DocParser",
      `Parsing docs for "${projectName}" at ${projectRoot}`,
    );
    const docMetaMap: DocMetaMap = new Map();
    if (docs === null || docs === undefined) {
      return docMetaMap;
    }
    for (const doc of Object.values(docs)) {
      const { package_name, name, original_file_path } = doc;
      const packageName = package_name;
      const packagePath = project.getPackageInstallPath();
      if (packagePath === undefined) {
        throw new Error("packagePath is not defined in " + projectRoot);
      }
      const docName =
        packageName === projectName ? name : `${packageName}.${name}`;
      const fullPath = createFullPathForNode(
        projectName,
        projectRoot,
        packageName,
        packagePath,
        original_file_path,
      );
      if (!fullPath) {
        return docMetaMap;
      }
      try {
        const docFile: string = readFileSync(fullPath).toString("utf8");
        const macroFileLines = docFile.split("\n");
        for (let index = 0; index < macroFileLines.length; index++) {
          const currentLine = macroFileLines[index];
          if (currentLine.match(new RegExp(`docs\\s${name}`))) {
            docMetaMap.set(docName, {
              path: fullPath,
              line: index,
              character: currentLine.indexOf(name),
            });
            break;
          }
        }
      } catch (error) {
        this.terminal.debug(
          "DocParser",
          `File not found at '${fullPath}', probably compiled is outdated, error is ignored`,
          error,
        );
      }
    }
    this.terminal.debug(
      "DocParser",
      `Returning docs for "${projectName}" at ${projectRoot}`,
      docMetaMap,
    );
    return docMetaMap;
  }
}
