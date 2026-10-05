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
  const next = render(current);
  const { start, end, replacement } = changedRange(current, next);
  edit.replace(
    uri,
    new Range(document.positionAt(start), document.positionAt(end)),
    replacement,
  );
  if (!(await workspace.applyEdit(edit))) {
    return "rejected";
  }
  if (hadUnsavedChanges) {
    return "applied-unsaved";
  }
  return (await document.save()) ? "saved" : "rejected";
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** The smallest range of `before` whose replacement turns it into `after`, from their common prefix and suffix. */
function changedRange(
  before: string,
  after: string,
): { start: number; end: number; replacement: string } {
  const limit = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < limit && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  // Never split a surrogate pair: a boundary inside one is not a valid position.
  if (prefix > 0 && isHighSurrogate(before.charCodeAt(prefix - 1))) {
    prefix -= 1;
  }
  if (suffix > 0 && isLowSurrogate(before.charCodeAt(before.length - suffix))) {
    suffix -= 1;
  }
  return {
    start: prefix,
    end: before.length - suffix,
    replacement: after.slice(prefix, after.length - suffix),
  };
}
