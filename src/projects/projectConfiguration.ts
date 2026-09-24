import { DBT_PROJECT_FILE } from "@altimateai/dbt-integration";
import { existsSync } from "fs";
import * as path from "path";
import { Uri, workspace, WorkspaceFolder } from "vscode";

export const CONFIGURATION_SECTION = "fusionPowerUser";
export const PROJECTS_SETTING = "projects";

export type ProjectConfigurationProblem =
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

/** Resolves one workspace folder's Declared Project roots in declaration order. */
export function resolveDeclaredProjectRoots(
  folder: WorkspaceFolder,
): DeclaredProjectRoots {
  const value = workspace
    .getConfiguration(CONFIGURATION_SECTION, folder.uri)
    .get<unknown>(PROJECTS_SETTING, []);

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

    const resolved = path.resolve(folder.uri.fsPath, trimmed);
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
  return existsSync(path.join(root, DBT_PROJECT_FILE));
}
