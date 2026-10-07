import { window } from "vscode";
import type { RegisterCommand } from "../../commandRegistry";
import type { DeferToProductionStatusBar } from "./deferToProductionStatusBar";

export function registerDeferCommands(
  statusBar: DeferToProductionStatusBar,
  register: RegisterCommand,
) {
  return [
    // Commands read defer settings when they run; this only refreshes the status bar.
    register("fusionPowerUser.applyDeferConfig", () => {
      statusBar.updateStatusBar();
      void window.showInformationMessage("Applied defer configuration");
    }),
  ];
}
