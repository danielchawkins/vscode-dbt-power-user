import { realpathSync } from "node:fs";
import * as path from "node:path";
import type { WorkspaceFolder } from "vscode";
import { Uri } from "vscode";
import { isStrictlyBelow } from "../../core/paths";
import { hasDbtProjectFile } from "../../core/snapshot/index";

const EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  "dbt_packages",
  "dbt_internal_packages",
  "target",
]);

/**
 * The nearest directory, up to the folder root, that holds `dbt_project.yml`
 * or `dbt_project.yaml` and that `accept` takes. `undefined` when the file lies outside the folder,
 * under an excluded directory, or has no accepted project above it. `exists` replaces the file check in tests.
 */
export function findProjectRootForFile(
  file: Uri,
  folder: WorkspaceFolder,
  {
    exists,
    accept = () => true,
  }: {
    exists?: (p: string) => boolean;
    accept?: (dir: string) => boolean;
  } = {},
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
    if (hasDbtProjectFile(dir, exists) && accept(dir)) {
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
  return isStrictlyBelow(folder, file)
    ? path.relative(folder, file)
    : undefined;
}
