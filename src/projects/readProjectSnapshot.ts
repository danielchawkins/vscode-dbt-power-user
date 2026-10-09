import * as os from "os";
import { Uri, workspace } from "vscode";
import {
  ProjectSnapshot,
  readDbtProjectFile,
  resolveProjectSnapshot,
} from "../core/project";
import {
  readEnvironment,
  readEnvironmentOverride,
  readSetting,
  SettingKey,
} from "../settings";

/** Every setting `readProjectSnapshot` reads; a change to any of them may change a snapshot. */
export const PROJECT_SNAPSHOT_SETTINGS: readonly SettingKey[] = [
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

/** Reads every input of one Declared Project's snapshot, each once, and resolves it. */
export function readProjectSnapshot(root: Uri): ProjectSnapshot {
  return resolveProjectSnapshot({
    root: root.fsPath,
    folder: workspace.getWorkspaceFolder(root)?.uri.fsPath,
    firstWorkspaceFolder: workspace.workspaceFolders?.[0]?.uri.fsPath,
    userHome: os.homedir(),
    environment: readEnvironment(),
    lspCompiledOutputOverride: readEnvironmentOverride("lspCompiledOutput"),
    settings: {
      dbtPath: readSetting("dbtPath", root),
      target: readSetting("target", root),
      profile: readSetting("profile", root),
      profilesDir: readSetting("profilesDir", root),
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
