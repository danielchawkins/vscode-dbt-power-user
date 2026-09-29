import * as path from "path";
import { Uri } from "vscode";
import { declaredProjectName, readDbtProjectFile } from "../core/project";

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

/** Model, macro and seed paths together; undefined until all three are known. */
export function sourcePathsOf(paths: {
  getModelPaths(): string[] | undefined;
  getMacroPaths(): string[] | undefined;
  getSeedPaths(): string[] | undefined;
}): string[] | undefined {
  const modelPaths = paths.getModelPaths();
  const macroPaths = paths.getMacroPaths();
  const seedPaths = paths.getSeedPaths();
  if (!modelPaths || !macroPaths || !seedPaths) {
    return undefined;
  }
  return [...modelPaths, ...macroPaths, ...seedPaths];
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
  return uri.path.replace(new RegExp(projectRoot + "/", "g"), "").split("/")[1];
}
