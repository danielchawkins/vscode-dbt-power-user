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
} from "../settings";

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
      profilesDir: readSetting("profilesDir", root),
      staticAnalysis: readSetting("staticAnalysis", root),
      lspCompiledOutput: readSetting("lsp.compiledOutput", root),
      deferPerProject: readSetting("defer.perProject", root),
      runParams: readSetting("run.additionalParams") ?? [],
      buildParams: readSetting("build.additionalParams") ?? [],
      testParams: readSetting("test.additionalParams") ?? [],
    },
    projectFile: readDbtProjectFile(root.fsPath),
  });
}
