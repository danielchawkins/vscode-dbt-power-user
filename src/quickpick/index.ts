import { commands, Disposable, window } from "vscode";
import { ExtensionContextStore } from "../extensionContext";
import { CurrentProject } from "../projects/currentProject";
import { ProjectQuickPickItem } from "./projectQuickPick";

export class DbtPowerUserActionsCenter implements Disposable {
  private disposables: Disposable[] = [];

  constructor(
    private currentProject: CurrentProject,
    private extensionContext: ExtensionContextStore,
  ) {
    this.disposables.push(
      commands.registerCommand("fusionPowerUser.pickProject", async () => {
        const project = await this.currentProject.pickForCommand();
        if (project) {
          const pickedProject: ProjectQuickPickItem = {
            label: project.name,
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
