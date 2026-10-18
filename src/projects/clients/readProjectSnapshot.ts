import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Uri } from "vscode";
import { workspace } from "vscode";
import type { ProjectSnapshot } from "../../core/snapshot/index";
import {
  deferSettingsKey,
  readDbtProjectFile,
  resolveProjectSnapshot,
  resolveSettingPath,
} from "../../core/snapshot/index";
import type { SettingKey } from "../../settings/index";
import {
  readEnvironment,
  readEnvironmentOverride,
  readProjectSetting,
  readSetting,
} from "../../settings/index";

/** Every setting `readProjectSnapshot` reads; a change to any of them may change a snapshot. */
export const PROJECT_SNAPSHOT_SETTINGS: readonly SettingKey[] = [
  "projects",
  "perProject",
  "dbtPath",
  "target",
  "profile",
  "profilesDir",
  "staticAnalysis",
  "lsp.compiledOutput",
  "lint.enabled",
  "lsp.maxErrorReporting",
  "trace.server",
  "defer.perProject",
  "run.additionalParams",
  "build.additionalParams",
  "test.additionalParams",
];

/**
 * Reads every input of one Declared Project's snapshot, each once, and resolves it. `environment` is what the
 * project's dbt processes inherit; it defaults to the extension host's.
 *
 * Project settings follow dbt's layering: the folder's value applies to every project in it, and the project's
 * `perProject` entry, keyed by its path relative to the folder, overrides it. A project the folder does not
 * configure (one declared by an opened file) that has its own `profiles.yml` reads that file unless its entry names
 * a `profilesDir`: the folder's `profilesDir` and a `DBT_PROFILES_DIR` were set for the configured projects.
 */
export function readProjectSnapshot(
  root: Uri,
  environment: Readonly<Record<string, string>> = readEnvironment(),
): ProjectSnapshot {
  const folder = workspace.getWorkspaceFolder(root);
  const folderPath = folder?.uri.fsPath;
  const entry = readSetting("perProject", root)?.[
    deferSettingsKey(root.fsPath, folderPath)
  ];
  const ownProfiles =
    entry?.profilesDir === undefined &&
    !isConfigured(root, folderPath, environment) &&
    existsSync(path.join(root.fsPath, "profiles.yml"));
  return resolveProjectSnapshot({
    root: root.fsPath,
    folder: folderPath,
    firstWorkspaceFolder: workspace.workspaceFolders?.[0]?.uri.fsPath,
    userHome: os.homedir(),
    environment,
    lspCompiledOutputOverride: readEnvironmentOverride("lspCompiledOutput"),
    settings: {
      dbtPath: readProjectSetting("dbtPath", root),
      target: readProjectSetting("target", root),
      profile: readProjectSetting("profile", root),
      profilesDir: ownProfiles
        ? root.fsPath
        : readProjectSetting("profilesDir", root),
      staticAnalysis: readProjectSetting("staticAnalysis", root),
      lspCompiledOutput: readProjectSetting("lsp.compiledOutput", root),
      lintEnabled: readProjectSetting("lint.enabled", root),
      maxErrorReporting: readProjectSetting("lsp.maxErrorReporting", root),
      traceServer: readProjectSetting("trace.server", root),
      deferPerProject: readSetting("defer.perProject", root),
      runParams: readSetting("run.additionalParams") ?? [],
      buildParams: readSetting("build.additionalParams") ?? [],
      testParams: readSetting("test.additionalParams") ?? [],
    },
    projectFile: readDbtProjectFile(root.fsPath),
  });
}

/** Whether the folder's `projects` setting, or its root fallback when unset, names `root`. */
function isConfigured(
  root: Uri,
  folderPath: string | undefined,
  environment: Readonly<Record<string, string>>,
): boolean {
  if (folderPath === undefined) {
    return true;
  }
  const entries = readSetting("projects", root) ?? [];
  if (entries.length === 0) {
    return root.fsPath === folderPath;
  }
  return entries.some(
    (entry) =>
      typeof entry === "string" &&
      entry.trim() !== "" &&
      resolveSettingPath(entry, {
        folder: folderPath,
        userHome: os.homedir(),
        lookup: (name) => environment[name],
      }).path === root.fsPath,
  );
}
