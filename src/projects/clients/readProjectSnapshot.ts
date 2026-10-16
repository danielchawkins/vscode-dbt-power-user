import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Uri } from "vscode";
import { workspace } from "vscode";
import type { ProjectSnapshot } from "../../core/snapshot/index";
import {
  readDbtProjectFile,
  resolveProjectSnapshot,
  resolveSettingPath,
} from "../../core/snapshot/index";
import type { SettingKey } from "../../settings/index";
import {
  readEnvironment,
  readEnvironmentOverride,
  readSetting,
} from "../../settings/index";

/** Every setting `readProjectSnapshot` reads; a change to any of them may change a snapshot. */
export const PROJECT_SNAPSHOT_SETTINGS: readonly SettingKey[] = [
  "projects",
  "dbtPath",
  "target",
  "profile",
  "profilesDir",
  "staticAnalysis",
  "lsp.compiledOutput",
  "lint.enabled",
  "trace.server",
  "defer.perProject",
  "run.additionalParams",
  "build.additionalParams",
  "test.additionalParams",
];

/**
 * Reads every input of one Declared Project's snapshot, each once, and resolves it. `environment` is what the
 * project's dbt processes inherit; it defaults to the extension host's. A project the folder does not configure
 * (one declared by an opened file) that has its own `profiles.yml` reads that file: the folder's `profilesDir` and a
 * `DBT_PROFILES_DIR` in the environment were set for the configured projects, not for a test fixture beside them.
 */
export function readProjectSnapshot(
  root: Uri,
  environment: Readonly<Record<string, string>> = readEnvironment(),
): ProjectSnapshot {
  const folder = workspace.getWorkspaceFolder(root);
  const folderPath = folder?.uri.fsPath;
  const entries = readSetting("projects", root) ?? [];
  const configured =
    folderPath === undefined ||
    (entries.length === 0
      ? root.fsPath === folderPath
      : entries.some(
          (entry) =>
            typeof entry === "string" &&
            entry.trim() !== "" &&
            resolveSettingPath(entry, {
              folder: folderPath,
              userHome: os.homedir(),
              lookup: (name) => environment[name],
            }).path === root.fsPath,
        ));
  const ownProfiles =
    !configured && existsSync(path.join(root.fsPath, "profiles.yml"));
  return resolveProjectSnapshot({
    root: root.fsPath,
    folder: folderPath,
    firstWorkspaceFolder: workspace.workspaceFolders?.[0]?.uri.fsPath,
    userHome: os.homedir(),
    environment,
    lspCompiledOutputOverride: readEnvironmentOverride("lspCompiledOutput"),
    settings: {
      dbtPath: readSetting("dbtPath", root),
      target: readSetting("target", root),
      profile: readSetting("profile", root),
      profilesDir: ownProfiles ? root.fsPath : readSetting("profilesDir", root),
      staticAnalysis: readSetting("staticAnalysis", root),
      lspCompiledOutput: readSetting("lsp.compiledOutput", root),
      lintEnabled: readSetting("lint.enabled", root),
      traceServer: readSetting("trace.server", root),
      deferPerProject: readSetting("defer.perProject", root),
      runParams: readSetting("run.additionalParams") ?? [],
      buildParams: readSetting("build.additionalParams") ?? [],
      testParams: readSetting("test.additionalParams") ?? [],
    },
    projectFile: readDbtProjectFile(root.fsPath),
  });
}
