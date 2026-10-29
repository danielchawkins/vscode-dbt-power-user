import type { RegisterCommand } from "../../commandRegistry";
import type { CurrentProject } from "../../projects/project/currentProject";
import type { ProjectSetupCommands } from "./projectSetupCommands";

/** Commands that validate a project and install its dependencies, on the Current Project's pick. */
export function registerProjectSetupCommands(
  currentProject: Pick<CurrentProject, "requireForCommand">,
  projectSetupCommands: ProjectSetupCommands,
  register: RegisterCommand,
) {
  return [
    register("fusionPowerUser.validateProject", async () =>
      projectSetupCommands.validateProjects(
        await currentProject.requireForCommand(),
      ),
    ),
    register("fusionPowerUser.installDeps", async () =>
      projectSetupCommands.installDeps(
        await currentProject.requireForCommand(),
      ),
    ),
  ];
}
