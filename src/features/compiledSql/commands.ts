import {
  commands,
  TextEditor,
  Uri,
  ViewColumn,
  window,
  workspace,
} from "vscode";
import type { RegisterCommand } from "../../commandRegistry";
import { activeModelUri, previewUriFor } from "../../projects/previewUri";

/**
 * Shows the model's single live compiled preview beside it as SQL, reusing a visible preview's group and
 * keeping focus on the model. With `toggle`, a visible preview closes instead.
 */
async function openCompiledPreview(
  modelUri: Uri,
  toggle: boolean,
): Promise<void> {
  const uri = previewUriFor(activeModelUri(modelUri));
  const visible = window.visibleTextEditors.find(
    (e) => e.document.uri.toString() === uri.toString(),
  );
  if (visible && toggle) {
    await window.showTextDocument(visible.document, visible.viewColumn, false);
    await commands.executeCommand("workbench.action.closeActiveEditor");
    return;
  }
  const doc = await workspace.openTextDocument(uri);
  await window.showTextDocument(doc, {
    viewColumn: visible?.viewColumn ?? ViewColumn.Beside,
    preserveFocus: true,
    preview: false,
  });
}

export function registerCompiledSqlCommands(register: RegisterCommand) {
  return [
    commands.registerTextEditorCommand(
      "fusionPowerUser.sqlPreview",
      (editor: TextEditor) => {
        void openCompiledPreview(editor.document.uri, true);
      },
    ),
    register("fusionPowerUser.showCompiledSQL", () => {
      const uri = window.activeTextEditor?.document.uri;
      return uri ? openCompiledPreview(uri, false) : undefined;
    }),
  ];
}
