import type { Disposable, TreeDataProvider } from "vscode";
import { window } from "vscode";
import type { MetadataDemand } from "../projects/manifest/metadataDemand";
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
      metadataDemand?: MetadataDemand;
    },
    runHistoryTreeviewProvider: RunHistoryTreeviewProvider,
  ) {
    this.childrenModelTreeview = childrenModelTreeview;
    this.parentModelTreeview = parentModelTreeview;
    this.runHistoryTreeviewProvider = runHistoryTreeviewProvider;
    const { metadataDemand } = parseTrees;
    this.testModelTreeview = parseTrees.test;
    this.documentationTreeView = parseTrees.documentation;
    this.disposables.push(
      this.testModelTreeview,
      this.parentModelTreeview,
      this.childrenModelTreeview,
      this.documentationTreeView,
      this.runHistoryTreeviewProvider,
      ...this.metadataConsumerView(
        "model_test_treeview",
        this.testModelTreeview,
        metadataDemand,
      ),
      ...this.metadataConsumerView(
        "parent_model_treeview",
        this.parentModelTreeview,
        metadataDemand,
      ),
      ...this.metadataConsumerView(
        "children_model_treeview",
        this.childrenModelTreeview,
        metadataDemand,
      ),
      ...this.metadataConsumerView(
        "documentation_treeview",
        this.documentationTreeView,
        metadataDemand,
      ),
      window.registerTreeDataProvider(
        "run_history_treeview",
        this.runHistoryTreeviewProvider,
      ),
    );
  }

  /** Registers a tree that reads merged metadata; its visibility holds the demand that keeps that metadata current. */
  private metadataConsumerView<T>(
    id: string,
    provider: TreeDataProvider<T>,
    metadataDemand: MetadataDemand | undefined,
  ): Disposable[] {
    if (!metadataDemand) {
      return [window.registerTreeDataProvider(id, provider)];
    }
    const view = window.createTreeView(id, { treeDataProvider: provider });
    return [
      view,
      metadataDemand.follow(() => view.visible, view.onDidChangeVisibility),
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
