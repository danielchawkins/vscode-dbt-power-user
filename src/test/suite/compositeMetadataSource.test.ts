import { describe, expect, it, vi } from "vitest";
import { EventEmitter, Uri } from "vscode";
import { emptyParsedManifest } from "../../core/metadata";
import type { ParsedManifest } from "../../dbt_integration/domain";
import { CompositeMetadataSource } from "../../metadata/compositeMetadataSource";
import type { ServerMetadataSource } from "../../metadata/serverMetadataSource";
import type { Manifest } from "../../projects/manifestTypes";
import type { Project } from "../../projects/project";
import type { DeclaredProject } from "../../projects/projectRegistry";

const node = (id: string, deps: string[] = []) => ({
  unique_id: id,
  name: id.split(".").pop(),
  resource_type: "model",
  package_name: "p",
  original_file_path: "models/a.sql",
  config: { materialized: "table" },
  depends_on: { nodes: deps },
});

function setup() {
  let epoch = 0;
  let manifest: Manifest | undefined;
  const parsed = new EventEmitter<ParsedManifest>();
  const project = {
    projectRoot: Uri.file("/p"),
    getProjectName: () => "p",
    get manifest() {
      return manifest;
    },
    onDidParse: parsed.event,
    rebuildManifest: vi.fn(async () => undefined),
    publishMerged: vi.fn((merged: object) => {
      manifest = { ...(merged as Manifest), publicationEpoch: ++epoch };
      return manifest;
    }),
  } as unknown as Project;
  const serverChanged = new EventEmitter<unknown>();
  let serverValue: unknown;
  const server = {
    onDidChange: serverChanged.event,
    current: () => serverValue,
    refresh: vi.fn(async () => undefined),
    dispose: vi.fn(),
  } as unknown as ServerMetadataSource;
  const declared = { root: Uri.file("/p"), name: "p" } as DeclaredProject;
  const source = new CompositeMetadataSource(declared, project, server);
  const published: Manifest[] = [];
  source.onDidPublish((m) => published.push(m));
  return {
    source,
    published,
    parse: () => {
      parsed.fire(emptyParsedManifest());
    },
    serverUpdate: (nodes: unknown[]) => {
      serverValue = {
        nodes: nodes.map((n) => ({
          uniqueId: (n as { unique_id: string }).unique_id,
          name: (n as { name: string }).name,
          resourceType: "model",
          packageName: "p",
          originalFilePath: "models/a.sql",
          materialized: "table",
          dependsOn: (n as ReturnType<typeof node>).depends_on.nodes,
        })),
        info: undefined,
        signature: String(nodes.length),
      };
      serverChanged.fire(serverValue);
    },
  };
}

describe("CompositeMetadataSource", () => {
  it("publishes nothing from the server before the first parse", () => {
    const { serverUpdate, published } = setup();
    serverUpdate([node("model.p.a")]);
    expect(published).toEqual([]);
  });

  it("fires exactly once per parse update and per server update, each with the merged value", () => {
    const { parse, serverUpdate, published } = setup();
    parse();
    expect(published).toHaveLength(1);
    serverUpdate([node("model.p.a"), node("model.p.b", ["model.p.a"])]);
    expect(published).toHaveLength(2);
    const merged = published[1];
    expect([...merged.graphMetaMap.parents.keys()].sort()).toEqual([
      "model.p.a",
      "model.p.b",
    ]);
    expect(merged.publicationEpoch).toBeGreaterThan(
      published[0].publicationEpoch,
    );
    parse();
    expect(published).toHaveLength(3);
  });

  it("refreshes both producers", async () => {
    const { source } = setup();
    await source.refresh();
    expect(source.current()).toBeUndefined();
  });
});
