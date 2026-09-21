import { commands, Disposable, window } from "vscode";
import { DBTProjectContainer } from "../dbt_client/dbtProjectContainer";
import { ProjectContext } from "../projects/projectContext";
import { SharedStateService } from "../services/sharedStateService";
import { DbtPowerUserControlCenterAction } from "./actionsQuickPick";
import { ProjectQuickPickItem } from "./projectQuickPick";

export class DbtPowerUserActionsCenter implements Disposable {
  private disposables: Disposable[] = [];

  constructor(
    private puLaunchQuickPick: DbtPowerUserControlCenterAction,
    private projectContext: ProjectContext,
    private dbtProjectContainer: DBTProjectContainer,
    private emitterService: SharedStateService,
  ) {
    commands.registerCommand("dbtPowerUser.puQuickPick", async () => {
      await this.puLaunchQuickPick.openActions();
    });
    commands.registerCommand("dbtPowerUser.pickProject", async () => {
      const project = await this.projectContext.pickForCommand();
      if (project) {
        const pickedProject: ProjectQuickPickItem = {
          label: project.name,
          description: project.root.fsPath,
          uri: project.root,
        };
        this.dbtProjectContainer.setToWorkspaceState(
          "dbtPowerUser.projectSelected",
          pickedProject,
        );
        window.showInformationMessage(
          "You have successfully selected " + pickedProject.label + ".",
        );
      }
    });
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
