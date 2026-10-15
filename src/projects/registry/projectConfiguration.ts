import * as os from "node:os";
import * as path from "node:path";
import type { WorkspaceFolder } from "vscode";
import { Uri } from "vscode";
import {
  hasDbtProjectFile,
  resolveSettingPath,
} from "../../core/snapshot/index";
import {
  readEnvironment,
  readSetting,
  writeDeclaredProjects,
} from "../../settings/index";

export const PROJECTS_SETTING = "projects";
export const ENABLED_SETTING = "enabled";

/** One `projects` entry as a path: `~`, `${userHome}`, `${env:NAME}` and `${workspaceFolder}` expand. */
function resolveEntry(folder: WorkspaceFolder, entry: string): string {
  return resolveSettingPath(entry, {
    folder: folder.uri.fsPath,
    userHome: os.homedir(),
    lookup: (name) => readEnvironment()[name],
  }).path;
}

type ProjectConfigurationProblem =
  | { reason: "invalidEntry"; entry: string }
  | { reason: "missingProjectFile"; entry: string; root: string };

/** Resolved project roots and blocking configuration problems for one folder. */
export interface DeclaredProjectRoots {
  folder: WorkspaceFolder;
  /** Declaration-ordered roots; empty when any problem is reported. */
  roots: Uri[];
  source: "explicit" | "folderRoot";
  /** Problems that the Project Registry reports to its output channel. */
  problems: readonly ProjectConfigurationProblem[];
}

/** Resolves one workspace folder's Declared Project roots in declaration order; none when the folder is disabled. */
export function resolveDeclaredProjectRoots(
  folder: WorkspaceFolder,
): DeclaredProjectRoots {
  if (readSetting(ENABLED_SETTING, folder.uri) === false) {
    return { folder, roots: [], source: "folderRoot", problems: [] };
  }

  const value: unknown = readSetting(PROJECTS_SETTING, folder.uri);

  if (!Array.isArray(value) || value.length === 0) {
    return {
      folder,
      roots: hasProjectFile(folder.uri.fsPath) ? [folder.uri] : [],
      source: "folderRoot",
      problems: [],
    };
  }

  const roots: Uri[] = [];
  const problems: ProjectConfigurationProblem[] = [];
  const seenPaths = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== "string") {
      problems.push({ reason: "invalidEntry", entry: String(entry) });
      continue;
    }

    const trimmed = entry.trim();
    if (trimmed === "") {
      problems.push({ reason: "invalidEntry", entry });
      continue;
    }

    const resolved = resolveEntry(folder, trimmed);
    if (!hasProjectFile(resolved)) {
      problems.push({
        reason: "missingProjectFile",
        entry,
        root: resolved,
      });
      continue;
    }

    if (seenPaths.has(resolved)) {
      continue;
    }

    seenPaths.add(resolved);
    roots.push(Uri.file(resolved));
  }

  return {
    folder,
    roots: problems.length === 0 ? roots : [],
    source: "explicit",
    problems,
  };
}

function hasProjectFile(root: string): boolean {
  return hasDbtProjectFile(root);
}

/**
 * Adds `root` to the folder's Declared Project entries and keeps every configured entry, including broken ones.
 * An unset setting starts from the folder root when that holds a project file.
 */
export function addDeclaredProjectRoot(
  folder: WorkspaceFolder,
  root: Uri,
): Thenable<void> {
  const configured: unknown = readSetting(PROJECTS_SETTING, folder.uri);
  const current: unknown[] =
    Array.isArray(configured) && configured.length > 0
      ? configured
      : hasProjectFile(folder.uri.fsPath)
        ? ["."]
        : [];
  const resolvesToRoot = current.some(
    (entry) =>
      typeof entry === "string" &&
      entry.trim() !== "" &&
      resolveEntry(folder, entry) === root.fsPath,
  );
  const relative = path.relative(folder.uri.fsPath, root.fsPath) || ".";
  return writeDeclaredProjects(
    folder,
    resolvesToRoot ? current : [...current, relative],
  );
}
