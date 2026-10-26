import { readFileSync } from "node:fs";

import type { ManifestProject } from "./manifestProject";
import type { MacroMetaMap, MacroResource, ManifestResources } from "./types";

import type { Log } from "../log";
import { findDeclarationLine, resourcePaths } from "./utils";

export class MacroParser {
  private terminal: Pick<Log, "debug">;

  constructor(terminal: Pick<Log, "debug">) {
    this.terminal = terminal;
  }

  async createMacroMetaMap(
    macros: ManifestResources<MacroResource> | null | undefined,
    project: ManifestProject,
  ): Promise<MacroMetaMap> {
    const projectRoot = project.getProjectRoot();
    const projectName = project.getProjectName();
    this.terminal.debug(
      "MacroParser",
      `Parsing macros for "${projectName}" at ${projectRoot}`,
    );
    const macroMetaMap: MacroMetaMap = new Map();
    if (macros === null || macros === undefined) {
      return macroMetaMap;
    }
    const paths = resourcePaths(project);
    for (const [key, macro] of Object.entries(macros)) {
      const { package_name, name, original_file_path, depends_on } = macro;
      const packageName = package_name;
      const macroName =
        packageName === projectName ? name : `${packageName}.${name}`;
      const fullPath = paths.fileOf(packageName, original_file_path);
      if (!fullPath) {
        continue;
      }
      try {
        const macroFile: string = readFileSync(fullPath).toString("utf8");
        const declared = [
          findDeclarationLine(macroFile, "macro", `${name}(`),
          findDeclarationLine(
            macroFile,
            "test",
            `${name.replace("test_", "")}(`,
          ),
        ].filter((line) => line !== undefined);
        if (declared.length > 0) {
          const line = Math.min(...declared);
          const currentLine = macroFile.split("\n")[line] ?? "";
          macroMetaMap.set(macroName, {
            path: fullPath,
            line,
            character: currentLine.indexOf(name),
            unique_id: key,
            description: macro.description,
            arguments: macro.arguments,
            name,
            depends_on,
          });
        }
      } catch (error) {
        this.terminal.debug(
          "MacroParser",
          `File not found at '${fullPath}', probably compiled is outdated.`,
          error,
        );
      }
    }
    this.terminal.debug(
      "MacroParser",
      `Returning macros for "${projectName}" at ${projectRoot}`,
      macroMetaMap,
    );
    return macroMetaMap;
  }
}
