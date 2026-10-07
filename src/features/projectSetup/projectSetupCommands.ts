import { window } from "vscode";
import { ExtensionContextStore } from "../../extensionContext";
import { notifyError } from "../../projects/notifications";
import { OutputChannels } from "../../projects/outputChannels";
import {
  ProjectQuickPick,
  ProjectQuickPickItem,
} from "../../projects/projectQuickPick";
import { Projects } from "../../projects/projects";

enum PromptAnswer {
  YES = "Yes",
  NO = "No",
}

export class ProjectSetupCommands {
  constructor(
    private projects: Projects,
    private extensionContext: ExtensionContextStore,
    private projectQuickPick: ProjectQuickPick,
    private outputChannels: Pick<OutputChannels, "logFor">,
  ) {}

  private async resolveProject(
    projectContext: ProjectQuickPickItem | undefined,
  ): Promise<ProjectQuickPickItem | undefined> {
    if (projectContext !== undefined) {
      return projectContext;
    }

    const pickedProject = await this.projectQuickPick.projectPicker(
      this.projects.all(),
    );
    if (!pickedProject) {
      return undefined;
    }

    this.extensionContext.setToWorkspaceState(
      "fusionPowerUser.projectSelected",
      pickedProject,
    );
    return pickedProject;
  }

  async validateProjects(
    projectContext: ProjectQuickPickItem | undefined,
    skipConfirmation = false,
  ) {
    const projectContextResolved = await this.resolveProject(projectContext);
    if (projectContextResolved === undefined) {
      return;
    }
    const debugCommand = "dbt debug";
    if (!skipConfirmation) {
      const answer = await window.showInformationMessage(
        `Do you want to validate the project: ${projectContextResolved.label}? This will run the command '${debugCommand}' inside this project. Do you want to continue?`,
        PromptAnswer.YES,
        PromptAnswer.NO,
      );
      if (answer !== PromptAnswer.YES) {
        return;
      }
    }
    try {
      const project = this.projects.get(projectContextResolved.uri);
      if (project === undefined) {
        throw new Error(
          `Project ${projectContextResolved.label} was not found`,
        );
      }
      const runModelOutput = await project.debug();
      if (runModelOutput.fullOutput.includes("ERROR")) {
        throw new Error(runModelOutput.fullOutput);
      }
    } catch (err) {
      const log = this.outputChannels.logFor(projectContextResolved.uri);
      log.error(
        "validateProjectError",
        `Error when validating ${projectContextResolved.label}`,
        err,
      );
      void notifyError(
        {
          root: projectContextResolved.uri,
          name: projectContextResolved.label,
        },
        "Error running dbt debug",
        err,
      );
      throw err;
    }
  }

  async installDeps(
    projectContext: ProjectQuickPickItem | undefined,
    skipConfirmation = false,
  ) {
    const projectContextResolved = await this.resolveProject(projectContext);
    if (projectContextResolved === undefined) {
      return;
    }
    if (!skipConfirmation) {
      const answer = await window.showInformationMessage(
        `Do you want to install packages for the project: ${projectContextResolved.label}? This will run the command 'dbt deps' inside this project. Do you want to continue?`,
        PromptAnswer.YES,
        PromptAnswer.NO,
      );
      if (answer !== PromptAnswer.YES) {
        return;
      }
    }
    try {
      const project = this.projects.get(projectContextResolved.uri);
      if (project === undefined) {
        throw new Error(
          `Project ${projectContextResolved.label} was not found`,
        );
      }

      await project.installDeps();
    } catch (err) {
      const log = this.outputChannels.logFor(projectContextResolved.uri);
      log.error(
        "ProjectSetupCommands.installDeps",
        "Could not install deps",
        err,
      );
      void notifyError(
        {
          root: projectContextResolved.uri,
          name: projectContextResolved.label,
        },
        "Error installing dbt dependencies",
        err,
      );
      throw err;
    }
  }
}
