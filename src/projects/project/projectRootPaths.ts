import * as path from "node:path";
import type { Uri } from "vscode";
import {
  declaredProjectName,
  type ProjectPaths,
  readDbtProjectFile,
} from "../../core/snapshot/index";

/** The name `root`'s project file declares, else the directory name. */
export function projectNameAt(root: string): string {
  return (
    declaredProjectName(readDbtProjectFile(root).config) ??
    root.split(/[/\\]/).pop() ??
    root
  );
}

/** True when `fsPath` is `root` or under it. */
export function isWithinRoot(root: string, fsPath: string): boolean {
  return fsPath === root || fsPath.startsWith(root + path.sep);
}

/** Model, macro and seed paths together; undefined when the project has no paths yet. */
export function sourcePathsOf(
  paths: ProjectPaths | undefined,
): string[] | undefined {
  if (!paths) {
    return undefined;
  }
  return [...paths.modelPaths, ...paths.macroPaths, ...paths.seedPaths];
}

/** The installed package `uri` belongs to; undefined outside `packagesInstallPath`. */
export function packageNameOf(
  projectRoot: string,
  packagesInstallPath: string | undefined,
  uri: Uri,
): string | undefined {
  if (!packagesInstallPath || !uri.fsPath.startsWith(packagesInstallPath)) {
    return undefined;
  }
  return uri.path
    .replaceAll(new RegExp(projectRoot + "/", "g"), "")
    .split("/")[1];
}
