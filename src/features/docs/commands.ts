import { commands } from "vscode";
import type { RegisterCommand } from "../../commandRegistry";

export function registerDocsCommands(register: RegisterCommand) {
  return [
    register("fusionPowerUser.goToDocumentationEditor", () =>
      commands.executeCommand("workbench.view.extension.docs_edit_view"),
    ),
    register("fusionPowerUser.viewInDocEditor", () =>
      commands.executeCommand("fusionPowerUser.DocsEdit.focus"),
    ),
  ];
}
