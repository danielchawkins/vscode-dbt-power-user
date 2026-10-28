import { window } from "vscode";
import { notifyError } from "../../projects/output/notifications";
import type { OutputChannels } from "../../projects/output/outputChannels";
import type { Project } from "../../projects/project/project";
import type { ProjectDbtCommands } from "../../projects/project/projectDbtCommands";

const PromptAnswer = {
  YES: "Yes",
  NO: "No",
} as const;
type PromptAnswer = (typeof PromptAnswer)[keyof typeof PromptAnswer];

/** What project setup reads from each project. */
type SetupProject = Pick<Project, "getProjectName" | "root"> & {
  commands: Pick<ProjectDbtCommands, "debug" | "installDeps">;
};

export class ProjectSetupCommands {
  private outputChannels: Pick<OutputChannels, "logFor">;

  constructor({
    outputChannels,
  }: {
    outputChannels: Pick<OutputChannels, "logFor">;
  }) {
    this.outputChannels = outputChannels;
  }

  private async runSetup(
    project: SetupProject | undefined,
    skipConfirmation: boolean,
    step: {
      prompt: (label: string) => string;
      run: (project: SetupProject) => Promise<void>;
      logKey: string;
      logMessage: (label: string) => string;
      notice: string;
    },
  ) {
    if (project === undefined) {
      return;
    }
    const label = project.getProjectName();
    if (!skipConfirmation) {
      const answer = await window.showInformationMessage(
        step.prompt(label),
        PromptAnswer.YES,
        PromptAnswer.NO,
      );
      if (answer !== PromptAnswer.YES) {
        return;
      }
    }
    try {
      await step.run(project);
    } catch (err) {
      this.outputChannels
        .logFor(project.root)
        .error(step.logKey, step.logMessage(label), err);
      void notifyError({ root: project.root, name: label }, step.notice, err);
      throw err;
    }
  }

  validateProjects(
    project: SetupProject | undefined,
    skipConfirmation = false,
  ) {
    return this.runSetup(project, skipConfirmation, {
      prompt: (label) =>
        `Do you want to validate the project: ${label}? ` +
        "This will run the command 'dbt debug' inside this project. " +
        "Do you want to continue?",
      run: async (project) => {
        const output = await project.commands.debug();
        if (output.fullOutput.includes("ERROR")) {
          throw new Error(output.fullOutput);
        }
      },
      logKey: "validateProjectError",
      logMessage: (label) => `Error when validating ${label}`,
      notice: "Error running dbt debug",
    });
  }

  installDeps(project: SetupProject | undefined, skipConfirmation = false) {
    return this.runSetup(project, skipConfirmation, {
      prompt: (label) =>
        `Do you want to install packages for the project: ${label}? ` +
        "This will run the command 'dbt deps' inside this project. " +
        "Do you want to continue?",
      run: (project) => project.commands.installDeps(),
      logKey: "ProjectSetupCommands.installDeps",
      logMessage: () => "Could not install deps",
      notice: "Error installing dbt dependencies",
    });
  }
}
