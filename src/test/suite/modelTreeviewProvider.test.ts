import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { EventEmitter, Uri, window } from "vscode";
import {
  DocumentationTreeview,
  ParentModelTreeview,
} from "../../treeview_provider/modelTreeviewProvider";

const rootA = Uri.file("/workspace/a");
const modelPath = "/workspace/a/models/orders.sql";

const manifest = (): any => {
  const orders = {
    unique_id: "model.a.orders",
    name: "orders",
    alias: "orders",
    schema: "analytics",
    patch_path: null,
    columns: {},
    config: { materialized: "table" },
  };
  return {
    nodeMetaMap: {
      lookupByBaseName: (name: string) =>
        name === "orders" ? orders : undefined,
    },
    graphMetaMap: {
      parents: new Map([
        [
          "model.a.orders",
          {
            nodes: [
              {
                label: "stg_orders",
                key: "model.a.stg_orders",
                url: "/x.sql",
                resourceType: "model",
              },
            ],
          },
        ],
      ]),
    },
    modelDepthMap: new Map(),
  };
};

describe("model tree views", () => {
  let changed: EventEmitter<any>;
  let removed: EventEmitter<Uri>;
  let projects: Map<string, any>;
  let container: any;

  beforeEach(() => {
    changed = new EventEmitter<any>();
    removed = new EventEmitter<Uri>();
    projects = new Map();
    container = {
      onDidChangeManifest: changed.event,
      onDidRemoveProject: removed.event,
      findDBTProject: jest.fn((uri: Uri) =>
        [...projects.values()].find((p) =>
          uri.fsPath.startsWith(`${p.projectRoot.fsPath}/`),
        ),
      ),
    };
    (window.activeTextEditor as any) = {
      document: {
        uri: Uri.file(modelPath),
        fileName: modelPath,
        languageId: "sql",
      },
    };
  });

  it("refreshes on a manifest change for project A and empties when A is removed", async () => {
    const tree = new ParentModelTreeview(container);
    const onRefresh = jest.fn();
    tree.onDidChangeTreeData(onRefresh);

    expect(await tree.getChildren()).toEqual([]);

    const projectA = { projectRoot: rootA, manifest: manifest() };
    projects.set(rootA.fsPath, projectA);
    changed.fire(projectA);

    expect(onRefresh).toHaveBeenCalledTimes(1);
    const children = await tree.getChildren();
    expect(children.map((c) => c.key)).toEqual(["model.a.stg_orders"]);

    projects.delete(rootA.fsPath);
    removed.fire(rootA);

    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(await tree.getChildren()).toEqual([]);
  });

  it("returns no children without an active editor", async () => {
    projects.set(rootA.fsPath, { projectRoot: rootA, manifest: manifest() });
    (window.activeTextEditor as any) = undefined;
    const tree = new ParentModelTreeview(container);
    expect(await tree.getChildren()).toEqual([]);
  });

  it("documentation tree refreshes on manifest change and removal", async () => {
    const tree = new DocumentationTreeview(container);
    const onRefresh = jest.fn();
    tree.onDidChangeTreeData(onRefresh);

    const projectA = { projectRoot: rootA, manifest: manifest() };
    projects.set(rootA.fsPath, projectA);
    changed.fire(projectA);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    projects.delete(rootA.fsPath);
    removed.fire(rootA);
    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(await tree.getChildren(undefined as any)).toEqual([]);
  });
});
