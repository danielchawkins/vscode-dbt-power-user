import { window } from "vscode";
import type { RegisterCommand } from "../../commandRegistry";
import type { Projects } from "../../projects/projects";
import type { RunHistoryService } from "../../projects/runHistoryService";
import { rerunFromHistory } from "./rerunFromHistory";
import type { RunTreeItem } from "./runHistoryTreeItems";

export function registerRunHistoryCommands(
  projects: Projects,
  runHistoryService: RunHistoryService,
  register: RegisterCommand,
) {
  return [
    register("fusionPowerUser.rerunFromHistory", (item: RunTreeItem) => {
      rerunFromHistory(item.entry, (name) => projects.byName(name));
    }),
    register("fusionPowerUser.clearRunHistory", async () => {
      const confirm = await window.showWarningMessage(
        "Clear all run history entries?",
        { modal: true },
        "Clear",
      );
      if (confirm === "Clear") {
        runHistoryService.clear();
      }
    }),
  ];
}
