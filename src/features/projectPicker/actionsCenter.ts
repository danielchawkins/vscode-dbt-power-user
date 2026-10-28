import type { Disposable } from "vscode";
import { commands, window } from "vscode";
import type { ExtensionContextStore } from "../../extensionContext";
import type { CurrentProject } from "../../projects/project/currentProject";
import type { ProjectQuickPickItem } from "../../projects/project/projectQuickPick";

export class DbtPowerUserActionsCenter implements Disposable {
  private disposables: Disposable[] = [];
  private currentProject: CurrentProject;
  private extensionContext: ExtensionContextStore;

  constructor(
    currentProject: CurrentProject,
    extensionContext: ExtensionContextStore,
  ) {
    this.currentProject = currentProject;
    this.extensionContext = extensionContext;
    this.disposables.push(
      commands.registerCommand("fusionPowerUser.pickProject", async () => {
        const project = await this.currentProject.pickForCommand();
        if (project) {
          const pickedProject: ProjectQuickPickItem = {
            label: project.declared.name,
            description: project.root.fsPath,
            uri: project.root,
          };
          this.extensionContext.setToWorkspaceState(
            "fusionPowerUser.projectSelected",
            pickedProject,
          );
          window.showInformationMessage(
            "You have successfully selected " + pickedProject.label + ".",
          );
        }
      }),
    );
  }

  dispose() {
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}
