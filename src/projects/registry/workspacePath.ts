import { Uri, workspace } from "vscode";

export function getFirstWorkspacePath(): string {
  // CLI commands run from a workspace folder when one is open; otherwise fall
  // back to the extension host working directory.
  const folders = workspace.workspaceFolders;
  const first = folders?.[0];
  if (first) {
    return first.uri.fsPath;
  } else {
    return Uri.file("./").fsPath;
  }
}
