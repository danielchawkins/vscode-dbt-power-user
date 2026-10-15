import type { Disposable, TreeDataProvider } from "vscode";
import { window } from "vscode";
import type { ParseDemand } from "../projects/parseDemand";
import type { DocumentationTreeview } from "./modelTree/documentationTreeview";
import type {
  ChildrenModelTreeview,
  ModelTestTreeview,
  ParentModelTreeview,
} from "./modelTree/modelTreeviewProvider";
import type { RunHistoryTreeviewProvider } from "./runHistory/runHistoryTreeviewProvider";

export class TreeviewProviders implements Disposable {
  private disposables: Disposable[] = [];
  private readonly testModelTreeview: ModelTestTreeview;
  private readonly documentationTreeView: DocumentationTreeview;
  private childrenModelTreeview: ChildrenModelTreeview;
  private parentModelTreeview: ParentModelTreeview;
  private runHistoryTreeviewProvider: RunHistoryTreeviewProvider;

  constructor(
    childrenModelTreeview: ChildrenModelTreeview,
    parentModelTreeview: ParentModelTreeview,
    parseTrees: {
      test: ModelTestTreeview;
      documentation: DocumentationTreeview;
      parseDemand?: ParseDemand;
    },
    runHistoryTreeviewProvider: RunHistoryTreeviewProvider,
  ) {
    this.childrenModelTreeview = childrenModelTreeview;
    this.parentModelTreeview = parentModelTreeview;
    this.runHistoryTreeviewProvider = runHistoryTreeviewProvider;
    const { parseDemand } = parseTrees;
    this.testModelTreeview = parseTrees.test;
    this.documentationTreeView = parseTrees.documentation;
    this.disposables.push(
      this.testModelTreeview,
      this.parentModelTreeview,
      this.childrenModelTreeview,
      this.documentationTreeView,
      this.runHistoryTreeviewProvider,
      ...this.parseConsumerView(
        "model_test_treeview",
        this.testModelTreeview,
        parseDemand,
      ),
      window.registerTreeDataProvider(
        "parent_model_treeview",
        this.parentModelTreeview,
      ),
      window.registerTreeDataProvider(
        "children_model_treeview",
        this.childrenModelTreeview,
      ),
      ...this.parseConsumerView(
        "documentation_treeview",
        this.documentationTreeView,
        parseDemand,
      ),
      window.registerTreeDataProvider(
        "run_history_treeview",
        this.runHistoryTreeviewProvider,
      ),
    );
  }

  /** Registers a tree that reads parse-owned fields; its visibility keeps the parse current. */
  private parseConsumerView<T>(
    id: string,
    provider: TreeDataProvider<T>,
    parseDemand: ParseDemand | undefined,
  ): Disposable[] {
    if (!parseDemand) {
      return [window.registerTreeDataProvider(id, provider)];
    }
    const view = window.createTreeView(id, { treeDataProvider: provider });
    return [
      view,
      parseDemand.follow(() => view.visible, view.onDidChangeVisibility),
    ];
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
