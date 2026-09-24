import * as path from "path";
import * as vscode from "vscode";

/** Basename of the opened workspace folder; smoke suites use it to skip fixture-specific cases. */
export function currentFixtureName(): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder ? path.basename(folder.uri.fsPath) : undefined;
}
