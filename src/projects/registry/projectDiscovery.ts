import { realpathSync } from "node:fs";
import * as path from "node:path";
import type { WorkspaceFolder } from "vscode";
import { Uri } from "vscode";
import { hasDbtProjectFile } from "../../core/snapshot/index";

const EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  "dbt_packages",
  "dbt_internal_packages",
  "target",
]);

/**
 * The nearest directory, up to the folder root, that holds `dbt_project.yml`
 * or `dbt_project.yaml`. `undefined` when the file lies outside the folder,
 * under an excluded directory, or has no project above it.
 */
export function findProjectRootForFile(
  file: Uri,
  folder: WorkspaceFolder,
  exists?: (p: string) => boolean,
): Uri | undefined {
  const relative = relativeWithin(folder.uri.fsPath, file.fsPath);
  if (relative === undefined) {
    return undefined;
  }
  const segments = relative.split(path.sep).filter(Boolean);
  if (segments.some((segment) => EXCLUDED_DIRECTORIES.has(segment))) {
    return undefined;
  }
  // Drop the file name; walk the directories from deepest to the folder root.
  const directories = segments.slice(0, -1);
  for (let depth = directories.length; depth >= 0; depth--) {
    const dir = path.join(folder.uri.fsPath, ...directories.slice(0, depth));
    if (hasDbtProjectFile(dir, exists)) {
      return Uri.file(dir);
    }
  }
  return undefined;
}

function relativeWithin(folder: string, file: string): string | undefined {
  const direct = inside(folder, file);
  if (direct !== undefined) {
    return direct;
  }
  try {
    return inside(realpathSync.native(folder), realpathSync.native(file));
  } catch {
    return undefined;
  }
}

function inside(folder: string, file: string): string | undefined {
  const relative = path.relative(folder, file);
  return relative === "" ||
    relative === ".." ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative)
    ? undefined
    : relative;
}
