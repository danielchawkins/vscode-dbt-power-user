import {
  CancellationToken,
  CodeLens,
  CodeLensProvider,
  Command,
  Disposable,
  Range,
  TextDocument,
} from "vscode";
import { DBTProjectContainer } from "../dbt_client/dbtProjectContainer";
import { QueryManifestService } from "../services/queryManifestService";

export class VirtualSqlCodeLensProvider
  implements CodeLensProvider, Disposable
{
  private disposables: Disposable[] = [];

  constructor(
    private dbtProjectContainer: DBTProjectContainer,
    private queryManifestService: QueryManifestService,
  ) {}

  dispose() {
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private getProjectName() {
    const project = this.dbtProjectContainer.getFromWorkspaceState(
      "dbtPowerUser.projectSelected",
    );
    if (project?.label) {
      return project.label;
    }

    // Find the project name from the current active editor
    return this.queryManifestService.getProject()?.getProjectName();
  }

  public provideCodeLenses(
    document: TextDocument,
    token: CancellationToken,
  ): CodeLens[] | Thenable<CodeLens[]> {
    // Enable this code lens only for adhoc query files created using command: dbtPowerUser.createSqlFile
    if (
      document.uri.scheme !== "untitled" ||
      document.languageId !== "jinja-sql"
    ) {
      return [];
    }

    const topOfDocument = new Range(0, 0, 0, 0);
    const projectName = this.getProjectName();
    const projectSelectorCommand: Command = {
      title: `Project: ${projectName || "Select a project"}`,
      command: "dbtPowerUser.pickProject",
      arguments: [document.uri],
    };

    const projectSelectorCodeLens = new CodeLens(
      topOfDocument,
      projectSelectorCommand,
    );

    return [projectSelectorCodeLens];
  }
}
