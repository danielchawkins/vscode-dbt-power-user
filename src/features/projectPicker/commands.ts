import { window } from "vscode";
import type { RegisterCommand } from "../../commandRegistry";
import type { CurrentProject } from "../../projects/project/currentProject";

/** The Declared Project picker. The pick is held by Current Project, which every command that needs a project reads. */
export function registerProjectPickerCommands(
  currentProject: Pick<CurrentProject, "pickForCommand">,
  register: RegisterCommand,
) {
  return [
    register("fusionPowerUser.pickProject", async () => {
      const project = await currentProject.pickForCommand();
      if (project) {
        window.showInformationMessage(
          "You have successfully selected " + project.declared.name + ".",
        );
      }
    }),
  ];
}
