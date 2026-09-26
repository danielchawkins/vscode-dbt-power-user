import * as path from "path";
import * as vscode from "vscode";

/**
 * Fixture the host opened: the `.code-workspace` file's base name when opened as a workspace, otherwise the
 * single folder's name. Smoke suites use it to skip fixture-specific cases.
 */
export function currentFixtureName(): string | undefined {
  const workspaceFile = vscode.workspace.workspaceFile;
  if (workspaceFile?.scheme === "file") {
    return path.basename(workspaceFile.fsPath, ".code-workspace");
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder ? path.basename(folder.uri.fsPath) : undefined;
}
