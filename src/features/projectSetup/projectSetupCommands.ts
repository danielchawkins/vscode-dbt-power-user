import { window } from "vscode";
import { ExtensionContextStore } from "../../extensionContext";
import { notifyError } from "../../projects/notifications";
import { OutputChannels } from "../../projects/outputChannels";
import { Project } from "../../projects/project";
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

  private async runSetup(
    projectContext: ProjectQuickPickItem | undefined,
    skipConfirmation: boolean,
    step: {
      prompt: (label: string) => string;
      run: (project: Project) => Promise<void>;
      logKey: string;
      logMessage: (label: string) => string;
      notice: string;
    },
  ) {
    const resolved = await this.resolveProject(projectContext);
    if (resolved === undefined) {
      return;
    }
    if (!skipConfirmation) {
      const answer = await window.showInformationMessage(
        step.prompt(resolved.label),
        PromptAnswer.YES,
        PromptAnswer.NO,
      );
      if (answer !== PromptAnswer.YES) {
        return;
      }
    }
    try {
      const project = this.projects.get(resolved.uri);
      if (project === undefined) {
        throw new Error(`Project ${resolved.label} was not found`);
      }
      await step.run(project);
    } catch (err) {
      this.outputChannels
        .logFor(resolved.uri)
        .error(step.logKey, step.logMessage(resolved.label), err);
      void notifyError(
        { root: resolved.uri, name: resolved.label },
        step.notice,
        err,
      );
      throw err;
    }
  }

  validateProjects(
    projectContext: ProjectQuickPickItem | undefined,
    skipConfirmation = false,
  ) {
    return this.runSetup(projectContext, skipConfirmation, {
      prompt: (label) =>
        `Do you want to validate the project: ${label}? ` +
        "This will run the command 'dbt debug' inside this project. " +
        "Do you want to continue?",
      run: async (project) => {
        const output = await project.debug();
        if (output.fullOutput.includes("ERROR")) {
          throw new Error(output.fullOutput);
        }
      },
      logKey: "validateProjectError",
      logMessage: (label) => `Error when validating ${label}`,
      notice: "Error running dbt debug",
    });
  }

  installDeps(
    projectContext: ProjectQuickPickItem | undefined,
    skipConfirmation = false,
  ) {
    return this.runSetup(projectContext, skipConfirmation, {
      prompt: (label) =>
        `Do you want to install packages for the project: ${label}? ` +
        "This will run the command 'dbt deps' inside this project. " +
        "Do you want to continue?",
      run: (project) => project.installDeps(),
      logKey: "ProjectSetupCommands.installDeps",
      logMessage: () => "Could not install deps",
      notice: "Error installing dbt dependencies",
    });
  }
}
