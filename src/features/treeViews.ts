import { Disposable, window } from "vscode";
import {
  ChildrenModelTreeview,
  DocumentationTreeview,
  ModelTestTreeview,
  ParentModelTreeview,
} from "./modelTree/modelTreeviewProvider";
import { RunHistoryTreeviewProvider } from "./runHistory/runHistoryTreeviewProvider";

export class TreeviewProviders implements Disposable {
  private disposables: Disposable[] = [];

  constructor(
    private childrenModelTreeview: ChildrenModelTreeview,
    private parentModelTreeview: ParentModelTreeview,
    private testModelTreeview: ModelTestTreeview,
    private documentationTreeView: DocumentationTreeview,
    private runHistoryTreeviewProvider: RunHistoryTreeviewProvider,
  ) {
    this.disposables.push(
      this.testModelTreeview,
      this.parentModelTreeview,
      this.childrenModelTreeview,
      this.documentationTreeView,
      this.runHistoryTreeviewProvider,
      window.registerTreeDataProvider(
        "model_test_treeview",
        this.testModelTreeview,
      ),
      window.registerTreeDataProvider(
        "parent_model_treeview",
        this.parentModelTreeview,
      ),
      window.registerTreeDataProvider(
        "children_model_treeview",
        this.childrenModelTreeview,
      ),
      window.registerTreeDataProvider(
        "documentation_treeview",
        this.documentationTreeView,
      ),
      window.registerTreeDataProvider(
        "run_history_treeview",
        this.runHistoryTreeviewProvider,
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
  }
}
