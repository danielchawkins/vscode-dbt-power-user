import { existsSync } from "fs";
import { Range, Uri, workspace, WorkspaceEdit } from "vscode";

/**
 * How {@link writeUserFile} left the file: saved to disk, applied to an open document that already had unsaved
 * changes and left unsaved, or rejected by VS Code.
 */
export type UserFileWrite = "saved" | "applied-unsaved" | "rejected";

/**
 * Sets the text of the user file at `uri` through a `WorkspaceEdit`, creating the file when absent. `text` may be
 * a function of the current text, including unsaved editor changes ("" for an absent file), read immediately
 * before the edit. Saves the document unless it already had unsaved changes, which stay unsaved with the edit.
 */
export async function writeUserFile(
  uri: Uri,
  text: string | ((current: string) => string),
): Promise<UserFileWrite> {
  const render = typeof text === "string" ? () => text : text;
  const edit = new WorkspaceEdit();
  if (!existsSync(uri.fsPath)) {
    edit.createFile(uri, { contents: new TextEncoder().encode(render("")) });
    return (await workspace.applyEdit(edit)) ? "saved" : "rejected";
  }
  const document = await workspace.openTextDocument(uri);
  const hadUnsavedChanges = document.isDirty;
  const current = document.getText();
  const end = document.positionAt(current.length);
  edit.replace(uri, new Range(document.positionAt(0), end), render(current));
  if (!(await workspace.applyEdit(edit))) {
    return "rejected";
  }
  if (hadUnsavedChanges) {
    return "applied-unsaved";
  }
  return (await document.save()) ? "saved" : "rejected";
}
