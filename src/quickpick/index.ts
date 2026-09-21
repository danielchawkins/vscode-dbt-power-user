import { commands, Disposable, window } from "vscode";
import { DBTProjectContainer } from "../dbt_client/dbtProjectContainer";
import { SharedStateService } from "../services/sharedStateService";
import { DbtPowerUserControlCenterAction } from "./actionsQuickPick";
import { ProjectQuickPick } from "./projectQuickPick";

export class DbtPowerUserActionsCenter implements Disposable {
  private disposables: Disposable[] = [];

  constructor(
    private puLaunchQuickPick: DbtPowerUserControlCenterAction,
    private projectQuickPick: ProjectQuickPick,
    private dbtProjectContainer: DBTProjectContainer,
    private emitterService: SharedStateService,
  ) {
    commands.registerCommand("dbtPowerUser.puQuickPick", async () => {
      await this.puLaunchQuickPick.openActions();
    });
    commands.registerCommand("dbtPowerUser.pickProject", async () => {
      const pickedProject = await this.projectQuickPick.projectPicker(
        await this.dbtProjectContainer.getProjects(),
      );
      if (pickedProject) {
        this.dbtProjectContainer.setToWorkspaceState(
          "dbtPowerUser.projectSelected",
          pickedProject,
        );
        window.showInformationMessage(
          "You have succesfully selected " + pickedProject.label + ".",
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
