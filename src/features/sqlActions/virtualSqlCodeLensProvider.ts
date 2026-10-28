import type {
  CancellationToken,
  CodeLensProvider,
  Command,
  Disposable,
  TextDocument,
} from "vscode";
import { CodeLens, Range } from "vscode";
import type { CurrentProject } from "../../projects/project/currentProject";

export class VirtualSqlCodeLensProvider
  implements CodeLensProvider, Disposable
{
  private disposables: Disposable[] = [];
  private currentProject: CurrentProject;

  constructor(currentProject: CurrentProject) {
    this.currentProject = currentProject;
  }

  dispose() {
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private getProjectName() {
    return this.currentProject.current?.getProjectName();
  }

  public provideCodeLenses(
    document: TextDocument,
    _token: CancellationToken,
  ): CodeLens[] | Thenable<CodeLens[]> {
    // Enable this code lens only for untitled SQL queries.
    if (
      document.uri.scheme !== "untitled" ||
      document.languageId !== "jinja-sql"
    ) {
      return [];
    }

    const topOfDocument = new Range(0, 0, 0, 0);
    const projectName = this.getProjectName();
    const projectSelectorCommand: Command = {
      title: `Project: ${(projectName ?? "") || "Select a project"}`,
      command: "fusionPowerUser.pickProject",
      arguments: [document.uri],
    };

    const projectSelectorCodeLens = new CodeLens(
      topOfDocument,
      projectSelectorCommand,
    );

    return [projectSelectorCodeLens];
  }
}
