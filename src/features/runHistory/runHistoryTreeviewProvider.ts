import type { Disposable, Event, TreeDataProvider, TreeItem } from "vscode";
import { EventEmitter } from "vscode";
import { disposeAll } from "../../core/disposables";
import type { RunHistoryService } from "../../projects/output/runHistoryService";
import type { RunHistoryTreeItem } from "./runHistoryTreeItems";
import { ResultTreeItem, RunTreeItem } from "./runHistoryTreeItems";

export class RunHistoryTreeviewProvider
  implements TreeDataProvider<RunHistoryTreeItem>, Disposable
{
  private _onDidChangeTreeData = new EventEmitter<
    RunHistoryTreeItem | undefined | void
  >();
  readonly onDidChangeTreeData: Event<RunHistoryTreeItem | undefined | void> =
    this._onDidChangeTreeData.event;

  private disposables: Disposable[] = [this._onDidChangeTreeData];
  private runHistoryService: RunHistoryService;

  constructor(runHistoryService: RunHistoryService) {
    this.runHistoryService = runHistoryService;
    this.disposables.push(
      this.runHistoryService.onHistoryChanged(() => {
        this._onDidChangeTreeData.fire();
      }),
    );
  }

  // Called by VS Code's TreeDataProvider interface
  getTreeItem(element: RunHistoryTreeItem): TreeItem {
    return element;
  }

  // Called by VS Code's TreeDataProvider interface to populate the tree view
  getChildren(element?: RunHistoryTreeItem): RunHistoryTreeItem[] {
    if (!element) {
      const entries = this.runHistoryService.entries;
      return entries.map((entry) => new RunTreeItem(entry));
    }

    if (element instanceof RunTreeItem) {
      return element.entry.results.map(
        (result) => new ResultTreeItem(result, element.entry.command),
      );
    }

    return [];
  }

  dispose(): void {
    disposeAll(this.disposables);
  }
}
