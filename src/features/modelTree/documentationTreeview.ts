import * as path from "path";
import {
  Disposable,
  Event,
  EventEmitter,
  ProviderResult,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
  window,
} from "vscode";
import { removeProtocol } from "../../core/text";
import { Projects } from "../../projects/projects";
import {
  lookupModelByEditorContent,
  Node,
  refreshOnProjectChange,
} from "./treeSupport";

export class DocumentationTreeview
  implements TreeDataProvider<DocTreeItem>, Disposable
{
  private _onDidChangeTreeData: EventEmitter<DocTreeItem | undefined | void> =
    new EventEmitter<DocTreeItem | undefined | void>();
  readonly onDidChangeTreeData: Event<DocTreeItem | undefined | void> =
    this._onDidChangeTreeData.event;
  private disposables: Disposable[] = [this._onDidChangeTreeData];

  constructor(private projects: Projects) {
    this.disposables.push(
      ...refreshOnProjectChange(this.projects, () =>
        this._onDidChangeTreeData.fire(),
      ),
    );
  }

  getTreeItem(element: DocTreeItem): TreeItem {
    return {
      label: element.label,
      description: element.description,
      command: element.command,
      collapsibleState: element.children
        ? TreeItemCollapsibleState.Expanded
        : TreeItemCollapsibleState.None,
    };
  }

  getChildren(element: DocTreeItem): ProviderResult<DocTreeItem[]> {
    if (element) {
      return element.children;
    }
    const editor = window.activeTextEditor;
    const project = editor && this.projects.get(editor.document.uri);
    const event = project?.manifest;
    if (!editor || !project || !event) {
      return [];
    }
    const node = lookupModelByEditorContent(event.nodeMetaMap, editor.document);
    if (!node || Object.keys(node.columns).length === 0) {
      return [];
    }
    const url = node.patch_path
      ? path.join(project.projectRoot.fsPath, removeProtocol(node.patch_path))
      : " ";
    const description = `[ ${(node.config.materialized ?? "").toUpperCase()} ]  -  schema : ${node.schema}`;
    const treeItem = new DocTreeItem(
      new DocNode(node.alias, node.unique_id, url, description),
    );
    treeItem.children = Object.entries(node.columns).map(
      ([label, column]) =>
        ({ label, description: column.description }) as DocTreeItem,
    );
    return [treeItem];
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  dispose(): void {
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}

class DocTreeItem extends TreeItem {
  override collapsibleState: TreeItemCollapsibleState =
    TreeItemCollapsibleState.Collapsed;
  override description: string;
  children?: DocTreeItem[];
  constructor(node: DocNode) {
    super(node.label, TreeItemCollapsibleState.Collapsed);
    this.description = node.description !== undefined ? node.description : " ";
    // this. tooltip = "test tooltip" // node.description !== undefined ? node.description : " ";
    if (node.url) {
      this.command = {
        command: "vscode.open",
        title: "Open YML",
        arguments: [Uri.file(node.url)],
      };
    }
    if (node.iconPath !== undefined) {
      this.iconPath = {
        light: Uri.file(node.iconPath.light),
        dark: Uri.file(node.iconPath.dark),
      };
    }
  }
}

class DocNode extends Node {
  description: string;

  constructor(label: string, key: string, url: string, description: string) {
    super(label, key, url);
    this.description = description;
  }
}
