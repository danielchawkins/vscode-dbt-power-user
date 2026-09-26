import { inject } from "inversify";
import { window } from "vscode";
import { DBTProjectContainer } from "../dbt_client/dbtProjectContainer";
import { DBTTerminal } from "../dbt_integration";
import {
  ProjectQuickPick,
  ProjectQuickPickItem,
} from "../quickpick/projectQuickPick";

enum PromptAnswer {
  YES = "Yes",
  NO = "No",
}

export class ProjectSetupCommands {
  constructor(
    private dbtProjectContainer: DBTProjectContainer,
    private projectQuickPick: ProjectQuickPick,
    @inject("DBTTerminal")
    private dbtTerminal: DBTTerminal,
  ) {}

  private async resolveProject(
    projectContext: ProjectQuickPickItem | undefined,
  ): Promise<ProjectQuickPickItem | undefined> {
    if (projectContext !== undefined) {
      return projectContext;
    }

    const pickedProject = await this.projectQuickPick.projectPicker(
      await this.dbtProjectContainer.getProjects(),
    );
    if (!pickedProject) {
      return undefined;
    }

    this.dbtProjectContainer.setToWorkspaceState(
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
      const project = this.dbtProjectContainer.findDBTProject(
        projectContextResolved.uri,
      );
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
      this.dbtTerminal.error(
        "validateProjectError",
        `Error when validating ${projectContextResolved.label}`,
        err,
      );
      window.showErrorMessage(
        "Error running dbt debug for project " +
          projectContextResolved.label +
          ". Please check the output tab for more details.",
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
      const project = this.dbtProjectContainer.findDBTProject(
        projectContextResolved.uri,
      );
      if (project === undefined) {
        throw new Error(
          `Project ${projectContextResolved.label} was not found`,
        );
      }

      await project.installDeps();
    } catch (err) {
      this.dbtTerminal.debug(
        "ProjectSetupCommands.installDeps",
        "Could not install deps",
        err,
      );
      window.showErrorMessage(
        "Error installing dbt dependencies for project " +
          projectContextResolved.label +
          ". Please check the output tab for more details.",
      );
      throw err;
    }
  }
}
