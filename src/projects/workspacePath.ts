import { Uri, workspace } from "vscode";

export function getFirstWorkspacePath(): string {
  // CLI commands run from a workspace folder when one is open; otherwise fall
  // back to the extension host working directory.
  const folders = workspace.workspaceFolders;
  if (folders) {
    return folders[0].uri.fsPath;
  } else {
    return Uri.file("./").fsPath;
  }
}
