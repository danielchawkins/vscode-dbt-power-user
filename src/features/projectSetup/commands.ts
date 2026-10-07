import type { RegisterCommand } from "../../commandRegistry";
import type { ExtensionContextStore } from "../../extensionContext";
import type { ProjectQuickPickItem } from "../../projects/projectQuickPick";
import type { ProjectSetupCommands } from "./projectSetupCommands";

/** Commands that validate a project and install its dependencies, on the project picked last. */
export function registerProjectSetupCommands(
  extensionContext: ExtensionContextStore,
  projectSetupCommands: ProjectSetupCommands,
  register: RegisterCommand,
) {
  const picked = () =>
    extensionContext.getFromWorkspaceState<ProjectQuickPickItem>(
      "fusionPowerUser.projectSelected",
    );
  return [
    register("fusionPowerUser.validateProject", () =>
      projectSetupCommands.validateProjects(picked()),
    ),
    register("fusionPowerUser.installDeps", () =>
      projectSetupCommands.installDeps(picked()),
    ),
  ];
}
