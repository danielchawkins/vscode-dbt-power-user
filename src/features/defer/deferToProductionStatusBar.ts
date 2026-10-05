import {
  Disposable,
  StatusBarAlignment,
  StatusBarItem,
  TextEditor,
  window,
} from "vscode";
import type { Log } from "../../core/log";
import { Projects } from "../../projects/projects";
import { onDidChangeSettings } from "../../settings";

export class DeferToProductionStatusBar implements Disposable {
  readonly statusBar: StatusBarItem = window.createStatusBarItem(
    StatusBarAlignment.Left,
    9,
  );
  private disposables: Disposable[] = [];

  constructor(
    private projects: Projects,
    private dbtTerminal: Log,
  ) {
    this.disposables.push(
      onDidChangeSettings(["defer.perProject"], (change) => {
        if (change.affects()) {
          this.updateStatusBar();
        }
      }),
    );
    this.disposables.push(
      window.onDidChangeActiveTextEditor(
        async (event: TextEditor | undefined) => {
          if (event === undefined) {
            this.statusBar.hide();
          }
          this.updateStatusBar();
        },
      ),
    );
  }

  dispose() {
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
    this.statusBar.dispose();
  }

  private showTextInStatusBar(text: string) {
    this.statusBar.text = text;
    this.statusBar.show();
  }

  public updateStatusBar() {
    try {
      const currentProject = this.getCurrentProject();
      if (!currentProject) {
        this.statusBar.hide();
      }
      if (currentProject.getDeferConfig()?.deferToProduction) {
        this.showTextInStatusBar("$(sync) Defer");
        this.statusBar.show();
        return;
      }
      this.showTextInStatusBar("$(sync-ignored) Defer");
      this.statusBar.show();
    } catch (err) {
      this.statusBar.hide();
      this.dbtTerminal.debug(
        "DeferToProductionStatusBar",
        "Unable to update defer status bar",
        err,
      );
    }
  }

  private getCurrentProject() {
    const projects = this.projects.all();
    if (projects.length === 1) {
      return projects[0];
    }
    const currentFilePath = window.activeTextEditor?.document.uri;
    if (!currentFilePath) {
      throw new Error("No file selected in the editor");
    }
    const currentProject = this.projects.get(currentFilePath);

    if (!currentProject) {
      throw new Error("no Project found for selected document");
    }
    return currentProject;
  }
}
