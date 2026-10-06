import fc from "fast-check";
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import type { Log } from "../../core/log";
import {
  ChildrenParentParser,
  FunctionParser,
  GraphParser,
  NodeParser,
  SourceParser,
  TestParser,
  type ManifestProject,
} from "../../core/manifest";
import {
  FIELD_OWNERS,
  fieldsOwnedBy,
  mergeMetadata,
  serverMetadataFrom,
} from "../../core/metadata";
import type { ParsedManifest } from "../../dbt_integration/domain";
import { NUM_RUNS, nodeDag } from "../arbitraries";
import { esmDirname } from "../esmDirname";

const log = { debug: () => undefined } as unknown as Log;
const root = path.resolve(
  esmDirname(import.meta.url),
  "../fixtures/single-project",
);
const project: ManifestProject = {
  getProjectRoot: () => root,
  getProjectName: () => "p",
  getPackageInstallPath: () => path.join(root, "dbt_packages"),
  getTargetPath: () => path.join(root, "target"),
};

type RawNodes = Record<string, Record<string, unknown>>;

/** Parses raw `manifest.json` nodes the way `ManifestRebuild` does, for the resources the fixtures use. */
async function parseNodes(nodes: RawNodes): Promise<ParsedManifest> {
  const nodeMetaMap = await new NodeParser(log).createNodeMetaMap(
    nodes,
    project,
  );
  const sourceMetaMap = await new SourceParser(log).createSourceMetaMap(
    {},
    project,
  );
  const testMetaMap = await new TestParser(log).createTestMetaMap(
    nodes,
    project,
  );
  const functionMetaMap = await new FunctionParser(log).createFunctionMetaMap(
    {},
    project,
  );
  const maps = await new ChildrenParentParser().createChildrenParentMetaMap(
    nodes,
    {},
  );
  const graphMetaMap = new GraphParser(log).createGraphMetaMap(
    project,
    maps.parentMetaMap,
    maps.childMetaMap,
    nodeMetaMap,
    sourceMetaMap,
    testMetaMap,
    functionMetaMap,
    maps.constraintOnlyParents,
  );
  return {
    nodeMetaMap,
    sourceMetaMap,
    testMetaMap,
    functionMetaMap,
    graphMetaMap,
    modelDepthMap: new Map(),
    macroMetaMap: new Map(),
    metricMetaMap: new Map(),
    unitTestMetaMap: new Map(),
    docMetaMap: new Map(),
    exposureMetaMap: new Map(),
    semanticModelMetaMap: new Map(),
  };
}

const rawModel = (id: string, deps: string[] = []) => ({
  unique_id: id,
  name: id.split(".").pop(),
  resource_type: "model",
  package_name: "p",
  original_file_path: `models/${id.split(".").pop()}.sql`,
  alias: id.split(".").pop(),
  database: "d",
  schema: "s",
  description: "parsed description",
  columns: {},
  config: { materialized: "table" },
  depends_on: { nodes: deps, macros: [] },
});

/** The `dbt.listNodes` entry for a raw node. */
const serverEntry = (node: Record<string, unknown>) => ({
  unique_id: node.unique_id,
  name: node.name,
  resource_type: node.resource_type,
  package_name: "p",
  original_file_path: node.original_file_path,
  config: { materialized: "table", access: null, group: null },
  depends_on: node.depends_on,
});

const serverOf = (nodes: RawNodes) =>
  serverMetadataFrom(
    { nodes: Object.values(nodes).map(serverEntry) },
    { adapterType: "duckdb", projectName: "p" },
  );

const edgeSet = (map: ParsedManifest["graphMetaMap"]["parents"]) =>
  [...map.entries()]
    .flatMap(([from, { nodes }]) => nodes.map((n) => `${from}->${n.key}`))
    .sort();

describe("mergeMetadata", () => {
  it("equals the parse when the server has no value", async () => {
    const parse = await parseNodes({ "model.p.a": rawModel("model.p.a") });
    expect(mergeMetadata(undefined, parse)).toBe(parse);
  });

  it("builds the graph and depth of the single-project fixture from the server nodes alone", async () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "manifest.contract.json"), "utf8"),
    ) as { nodes: RawNodes };
    const merged = mergeMetadata(
      serverOf(manifest.nodes),
      await parseNodes(manifest.nodes),
    );
    const expected = Object.values(manifest.nodes)
      .filter((n) => n.resource_type === "model")
      .flatMap((n) =>
        (n.depends_on as { nodes: string[] }).nodes.map(
          (d) => `${n.unique_id}->${d}`,
        ),
      )
      .sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(edgeSet(merged.graphMetaMap.parents)).toEqual(expected);
    expect(edgeSet(merged.graphMetaMap.children)).toEqual(
      expected.map((e) => e.split("->").reverse().join("->")).sort(),
    );
    expect(Object.fromEntries(merged.modelDepthMap)).toEqual({
      broken_ref: 1,
      child: 2,
      "model.single_project.broken_ref": 1,
      "model.single_project.child": 2,
    });
  });

  it("keeps parse-owned fields and takes the server's graph for any DAG", async () => {
    await fc.assert(
      fc.asyncProperty(nodeDag, async (dag) => {
        const nodes: RawNodes = Object.fromEntries(
          Object.values(dag).map((n) => [
            n.unique_id,
            rawModel(n.unique_id, n.depends_on.nodes),
          ]),
        );
        const parse = await parseNodes({});
        const merged = mergeMetadata(serverOf(nodes), parse);
        for (const field of fieldsOwnedBy("parse")) {
          if (!field.includes(".") && field !== "nodeMetaMap") {
            expect(merged[field as keyof ParsedManifest]).toBe(
              parse[field as keyof ParsedManifest],
            );
          }
        }
        const ids = new Set(Object.keys(nodes));
        const parents = edgeSet(merged.graphMetaMap.parents);
        const children = edgeSet(merged.graphMetaMap.children);
        for (const edge of parents) {
          const [child, parent] = edge.split("->");
          expect(ids.has(child) && ids.has(parent)).toBe(true);
        }
        expect(children).toEqual(
          parents.map((e) => e.split("->").reverse().join("->")).sort(),
        );
        expect(parents).toEqual(
          Object.values(nodes)
            .flatMap((n) =>
              (n.depends_on as { nodes: string[] }).nodes.map(
                (d) => `${n.unique_id}->${d}`,
              ),
            )
            .sort(),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("adds a node the parse lacks with empty parse fields and drops one the server no longer lists", async () => {
    const parse = await parseNodes({
      "model.p.a": rawModel("model.p.a"),
      "model.p.gone": rawModel("model.p.gone"),
    });
    const now: RawNodes = {
      "model.p.a": rawModel("model.p.a"),
      "model.p.b": rawModel("model.p.b", ["model.p.a"]),
    };
    const merged = mergeMetadata(serverOf(now), parse);
    expect(merged.nodeMetaMap.lookupByUniqueId("model.p.gone")).toBeUndefined();
    expect(merged.nodeMetaMap.lookupByUniqueId("model.p.a")?.description).toBe(
      "parsed description",
    );
    const added = merged.nodeMetaMap.lookupByUniqueId("model.p.b");
    expect(added).toMatchObject({ description: "", columns: {} });
    expect(edgeSet(merged.graphMetaMap.parents)).toContain(
      "model.p.b->model.p.a",
    );
    expect(merged.graphMetaMap.parents.has("model.p.gone")).toBe(false);
    expect(merged.modelDepthMap.get("model.p.b")).toBe(2);
  });

  it("keeps a parse node of an installed package the server does not list", async () => {
    const parse = await parseNodes({
      "model.p.a": rawModel("model.p.a"),
      "model.pkg.shipped": {
        ...rawModel("model.pkg.shipped"),
        package_name: "pkg",
      },
    });
    const merged = mergeMetadata(
      serverOf({ "model.p.a": rawModel("model.p.a") }),
      parse,
    );
    expect(
      merged.nodeMetaMap.lookupByUniqueId("model.pkg.shipped"),
    ).toBeDefined();
    expect([...merged.nodeMetaMap.nodes()].map((n) => n.unique_id)).toContain(
      "model.pkg.shipped",
    );
  });

  it("keeps the parents of an analysis, which the server does not list", async () => {
    const model = rawModel("model.p.a");
    const nodes: RawNodes = {
      "model.p.a": model,
      "analysis.p.an": {
        ...rawModel("analysis.p.an", ["model.p.a"]),
        resource_type: "analysis",
        original_file_path: "analyses/an.sql",
      },
    };
    const parse = await parseNodes(nodes);
    const merged = mergeMetadata(serverOf({ "model.p.a": model }), parse);
    expect(edgeSet(merged.graphMetaMap.parents)).toContain(
      "analysis.p.an->model.p.a",
    );
    expect(edgeSet(merged.graphMetaMap.children)).toContain(
      "model.p.a->analysis.p.an",
    );
  });

  it("labels an endpoint outside the node set with its unique id", async () => {
    const nodes: RawNodes = {
      "model.p.a": rawModel("model.p.a", ["model.other.z"]),
    };
    const merged = mergeMetadata(serverOf(nodes), await parseNodes({}));
    expect(merged.graphMetaMap.parents.get("model.p.a")?.nodes).toEqual([
      expect.objectContaining({ key: "model.other.z", label: "model.other.z" }),
    ]);
  });
});

describe("FIELD_OWNERS", () => {
  it("assigns the graph and depth to the server", () => {
    expect(fieldsOwnedBy("server").sort()).toEqual(
      [
        "graphMetaMap.children",
        "graphMetaMap.parents",
        "modelDepthMap",
        "nodes",
      ].sort(),
    );
    expect(FIELD_OWNERS.nodeMetaMap).toBe("parse");
  });
});
