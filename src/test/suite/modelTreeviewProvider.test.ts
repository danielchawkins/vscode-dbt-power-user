import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { EventEmitter, Uri, window } from "vscode";
import {
  DocumentationTreeview,
  ParentModelTreeview,
} from "../../features/modelTree/modelTreeviewProvider";

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
  let byRoot: Map<string, any>;
  let projects: any;

  beforeEach(() => {
    changed = new EventEmitter<any>();
    removed = new EventEmitter<Uri>();
    byRoot = new Map();
    projects = {
      onDidChangeManifest: changed.event,
      onDidRemoveProject: removed.event,
      get: jest.fn((uri: Uri) =>
        [...byRoot.values()].find((p) =>
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
    const tree = new ParentModelTreeview(projects);
    const onRefresh = jest.fn();
    tree.onDidChangeTreeData(onRefresh);

    expect(await tree.getChildren()).toEqual([]);

    const projectA = { projectRoot: rootA, manifest: manifest() };
    byRoot.set(rootA.fsPath, projectA);
    changed.fire(projectA);

    expect(onRefresh).toHaveBeenCalledTimes(1);
    const children = await tree.getChildren();
    expect(children.map((c) => c.key)).toEqual(["model.a.stg_orders"]);

    byRoot.delete(rootA.fsPath);
    removed.fire(rootA);

    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(await tree.getChildren()).toEqual([]);
  });

  it("returns no children without an active editor", async () => {
    byRoot.set(rootA.fsPath, { projectRoot: rootA, manifest: manifest() });
    (window.activeTextEditor as any) = undefined;
    const tree = new ParentModelTreeview(projects);
    expect(await tree.getChildren()).toEqual([]);
  });

  it("documentation tree refreshes on manifest change and removal", async () => {
    const tree = new DocumentationTreeview(projects);
    const onRefresh = jest.fn();
    tree.onDidChangeTreeData(onRefresh);

    const projectA = { projectRoot: rootA, manifest: manifest() };
    byRoot.set(rootA.fsPath, projectA);
    changed.fire(projectA);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    byRoot.delete(rootA.fsPath);
    removed.fire(rootA);
    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(await tree.getChildren(undefined as any)).toEqual([]);
  });
});
