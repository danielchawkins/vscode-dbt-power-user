import { readFileSync } from "node:fs";

import type { ManifestProject } from "./manifestProject";
import type { DocMetaMap, ManifestResources } from "./types";

import type { Log } from "../log";
import { findDeclarationLine, resourcePaths } from "./utils";

export class DocParser {
  private terminal: Pick<Log, "debug">;

  constructor(terminal: Pick<Log, "debug">) {
    this.terminal = terminal;
  }

  async createDocMetaMap(
    docs: ManifestResources | null | undefined,
    project: ManifestProject,
  ): Promise<DocMetaMap> {
    const projectRoot = project.root.fsPath;
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
      const docName =
        packageName === projectName ? name : `${packageName}.${name}`;
      const fullPath = resourcePaths(project).fileOf(
        packageName,
        original_file_path,
      );
      if (!fullPath) {
        continue;
      }
      try {
        const docFile: string = readFileSync(fullPath).toString("utf8");
        const line = findDeclarationLine(docFile, "docs", name);
        if (line !== undefined) {
          const currentLine = docFile.split("\n")[line] ?? "";
          docMetaMap.set(docName, {
            path: fullPath,
            line,
            character: currentLine.indexOf(name),
          });
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
