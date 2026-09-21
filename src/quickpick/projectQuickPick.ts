import { QuickPickItem, Uri, window } from "vscode";
import { DBTProject } from "../dbt_client/dbtProject";
import { DeclaredProject } from "../projects/projectRegistry";

export interface ProjectQuickPickItem extends QuickPickItem {
  label: string;
  description: string;
  uri: Uri;
}

interface DeclaredProjectPickItem extends QuickPickItem {
  label: string;
  description: string;
  project: DeclaredProject;
}

export class ProjectQuickPick {
  async projectPicker(
    projects: DBTProject[],
  ): Promise<ProjectQuickPickItem | undefined> {
    const options: ProjectQuickPickItem[] = projects.map((item) => {
      return {
        label: item.getProjectName(),
        description: item.projectRoot.fsPath,
        uri: item.projectRoot,
      };
    });

    const pick: ProjectQuickPickItem | undefined = await window.showQuickPick(
      options,
      {
        title: "Select a Project",
        canPickMany: false,
      },
    );
    if (!pick) {
      return;
    }
    return pick;
  }

  /** Picks among Declared Projects; returns undefined when the user cancels. */
  async declaredProjectPicker(
    projects: readonly DeclaredProject[],
  ): Promise<DeclaredProject | undefined> {
    const options: DeclaredProjectPickItem[] = projects.map((project) => ({
      label: project.name,
      description: project.root.fsPath,
      project,
    }));

    const pick: DeclaredProjectPickItem | undefined =
      await window.showQuickPick(options, {
        title: "Select a Project",
        canPickMany: false,
      });

    return pick?.project;
  }
}
