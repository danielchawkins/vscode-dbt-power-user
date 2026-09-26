import { describe, expect, it } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { EventEmitter, Uri } from "vscode";
import { DBTProject } from "../../dbt_client/dbtProject";
import {
  ManifestCacheChangedEvent,
  ManifestCacheProjectAddedEvent,
} from "../../dbt_client/event/manifestCacheChangedEvent";
import {
  ChildrenParentParser,
  DBTTerminal,
  DocParser,
  ExposureParser,
  FunctionParser,
  GraphParser,
  MacroParser,
  ManifestProject,
  MetricParser,
  ModelDepthParser,
  NodeParser,
  SemanticModelParser,
  SourceParser,
  TestParser,
  UnitTestParser,
} from "../../dbt_integration";
import { ManifestMetadataSource } from "../../metadata/manifestMetadataSource";
import { DeclaredProject } from "../../projects/projectRegistry";
import { esmDirname } from "../esmDirname";

const fixtureRoot = path.resolve(
  esmDirname(import.meta.url),
  "../fixtures/single-project",
);
const generatedManifest = path.join(fixtureRoot, "target", "manifest.json");
const contractPath = path.join(fixtureRoot, "manifest.contract.json");

function loadManifestJson(): unknown {
  const manifestPath = fs.existsSync(generatedManifest)
    ? generatedManifest
    : contractPath;
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function mockTerminal(): DBTTerminal {
  return {
    debug: () => undefined,
    log: () => undefined,
    error: () => undefined,
    warn: () => undefined,
    logNewLine: () => undefined,
    logLine: () => undefined,
    logHorizontalRule: () => undefined,
    logBlock: () => undefined,
    logError: () => undefined,
    logWarning: () => undefined,
    logSuccess: () => undefined,
    disposables: [],
    writeEmitter: new EventEmitter<string>(),
    outputChannel: {
      append: () => undefined,
      appendLine: () => undefined,
      clear: () => undefined,
      show: () => undefined,
    },
    onDidWrite: new EventEmitter<string>().event,
    clear: () => undefined,
    show: () => undefined,
    dispose: () => undefined,
    write: () => undefined,
    processQueue: () => Promise.resolve(),
  } as unknown as DBTTerminal;
}

function mapKeys(map: Map<string, unknown>): string[] {
  return [...map.keys()].sort();
}

function projectMacroKeys(
  macros: Map<string, { unique_id: string }>,
): string[] {
  return [...macros.entries()]
    .filter(([, macro]) => macro.unique_id.split(".")[1] !== "dbt")
    .map(([key]) => key)
    .sort();
}

function graphShapes(graph: ManifestCacheProjectAddedEvent["graphMetaMap"]) {
  const strip = (map: typeof graph.parents) =>
    Object.fromEntries(
      [...map.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [
          key,
          {
            currentNode: value.currentNode
              ? {
                  key: value.currentNode.key,
                  resourceType: value.currentNode.resourceType,
                }
              : undefined,
            nodes: value.nodes.map((node) => ({
              key: node.key,
              resourceType: node.resourceType,
            })),
          },
        ]),
    );
  return {
    parents: strip(graph.parents),
    children: strip(graph.children),
    tests: strip(graph.tests),
    metrics: strip(graph.metrics),
  };
}

function macroShapes(macros: Map<string, { unique_id: string; name: string }>) {
  return [...macros.entries()]
    .filter(([, macro]) => macro.unique_id.split(".")[1] !== "dbt")
    .map(([key, macro]) => ({
      key,
      unique_id: macro.unique_id,
      name: macro.name,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function nodeShapes(event: ManifestCacheProjectAddedEvent) {
  return [...event.nodeMetaMap.nodes()]
    .map((node) => ({
      unique_id: node.unique_id,
      name: node.name,
      alias: node.alias,
      resource_type: node.resource_type,
      package_name: node.package_name,
      database: node.database,
      schema: node.schema,
    }))
    .sort((a, b) => a.unique_id.localeCompare(b.unique_id));
}

function sourceShapes(event: ManifestCacheProjectAddedEvent) {
  return [...event.sourceMetaMap.values()]
    .map((source) => ({
      unique_id: source.unique_id,
      name: source.name,
      database: source.database,
      schema: source.schema,
      package_name: source.package_name,
      tables: source.tables.map((table) => ({
        name: table.name,
        identifier: table.identifier,
      })),
    }))
    .sort((a, b) => a.unique_id.localeCompare(b.unique_id));
}

function testShapes(event: ManifestCacheProjectAddedEvent) {
  return [...event.testMetaMap.entries()]
    .map(([key, test]) => ({
      key,
      unique_id: test.unique_id,
      alias: test.alias,
      column_name: test.column_name,
      attached_node: test.attached_node,
      test_name: test.test_metadata?.name,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

describe("Metadata contract — shape and key set snapshot", () => {
  it("snapshots parser maps on ManifestCacheProjectAddedEvent", async () => {
    // parseManifest() passes records; published parser types incorrectly say arrays.
    const manifest = loadManifestJson() as {
      nodes: any;
      macros: any;
      sources: any;
      docs: any;
      exposures: any;
      functions: any;
      semantic_models: any;
      unit_tests: any;
    };
    const terminal = mockTerminal();
    const adapter = {
      getProjectRoot: () => fixtureRoot,
      getProjectName: () => "single_project",
      getPackageInstallPath: () => path.join(fixtureRoot, "dbt_packages"),
      getTargetPath: () => path.join(fixtureRoot, "target"),
    } as unknown as ManifestProject;
    const nodeMetaMap = await new NodeParser(terminal).createNodeMetaMap(
      manifest.nodes,
      adapter,
    );
    const macroMetaMap = await new MacroParser(terminal).createMacroMetaMap(
      manifest.macros,
      adapter,
    );
    const sourceMetaMap = await new SourceParser(terminal).createSourceMetaMap(
      manifest.sources,
      adapter,
    );
    const testMetaMap = await new TestParser(terminal).createTestMetaMap(
      manifest.nodes,
      adapter,
    );
    const functionMetaMap = await new FunctionParser(
      terminal,
    ).createFunctionMetaMap(manifest.functions, adapter);
    const parentMaps =
      await new ChildrenParentParser().createChildrenParentMetaMap(
        {
          ...manifest.nodes,
          ...manifest.exposures,
          ...manifest.functions,
        },
        manifest.sources,
      );
    const graphMetaMap = new GraphParser(terminal).createGraphMetaMap(
      adapter,
      parentMaps.parentMetaMap,
      parentMaps.childMetaMap,
      nodeMetaMap,
      sourceMetaMap,
      testMetaMap,
      functionMetaMap,
      parentMaps.constraintOnlyParents,
    );
    const modelDepthMap = new ModelDepthParser(terminal).createModelDepthsMap(
      manifest.nodes,
      parentMaps.parentMetaMap,
      parentMaps.childMetaMap,
    );
    const manifestEvents = new EventEmitter<ManifestCacheChangedEvent>();
    const project = {
      projectRoot: Uri.file(fixtureRoot),
      getProjectName: () => "single_project",
      getMetadataSnapshot: () => event,
      onManifestChanged: manifestEvents.event,
      rebuildManifest: async () => {},
    } as unknown as DBTProject;
    const event: ManifestCacheProjectAddedEvent = {
      project,
      nodeMetaMap,
      macroMetaMap,
      metricMetaMap: await new MetricParser(terminal).createMetricMetaMap(
        manifest.semantic_models,
        adapter,
      ),
      sourceMetaMap,
      graphMetaMap,
      testMetaMap,
      unitTestMetaMap: await new UnitTestParser(terminal).createUnitTestMetaMap(
        manifest.unit_tests ?? {},
        adapter,
      ),
      docMetaMap: await new DocParser(terminal).createDocMetaMap(
        manifest.docs,
        adapter,
      ),
      exposureMetaMap: await new ExposureParser(terminal).createExposureMetaMap(
        manifest.exposures,
        adapter,
      ),
      functionMetaMap,
      semanticModelMetaMap: await new SemanticModelParser(
        terminal,
      ).createSemanticModelMetaMap(manifest.semantic_models, adapter),
      modelDepthMap,
      publicationEpoch: 1,
      metadataProducer: "manifest",
    };
    const declaredProject = {
      root: Uri.file(fixtureRoot),
      name: "single_project",
      folder: { uri: Uri.file(fixtureRoot), name: "single_project", index: 0 },
      contains: () => true,
      dispose: () => {},
    } as DeclaredProject;
    const source = new ManifestMetadataSource(declaredProject, project);
    let forwarded: ManifestCacheProjectAddedEvent | undefined;
    source.onDidChangeMetadata((publication) => {
      forwarded = publication;
    });
    manifestEvents.fire({ added: [event] });
    expect(forwarded).toBe(event);
    expect(source.current()).toBe(event);
    if (!forwarded) {
      throw new Error("Expected metadata publication");
    }

    const nodeKeys = [...forwarded.nodeMetaMap.nodes()]
      .map((node) => node.unique_id)
      .sort();
    expect({
      nodeKeys,
      nodeShapes: nodeShapes(forwarded),
      macroKeys: projectMacroKeys(forwarded.macroMetaMap),
      macroShapes: macroShapes(forwarded.macroMetaMap),
      sourceKeys: mapKeys(forwarded.sourceMetaMap),
      sourceShapes: sourceShapes(forwarded),
      testKeys: mapKeys(forwarded.testMetaMap),
      testShapes: testShapes(forwarded),
      graphShapes: graphShapes(forwarded.graphMetaMap),
      docKeys: mapKeys(forwarded.docMetaMap),
      exposureKeys: mapKeys(forwarded.exposureMetaMap),
      functionKeys: mapKeys(forwarded.functionMetaMap),
      metricKeys: mapKeys(forwarded.metricMetaMap),
      semanticModelKeys: mapKeys(forwarded.semanticModelMetaMap),
      unitTestKeys: mapKeys(forwarded.unitTestMetaMap),
      modelDepthMap: Object.fromEntries(
        [...forwarded.modelDepthMap.entries()].sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      ),
    }).toMatchSnapshot();
    source.dispose();
    manifestEvents.dispose();
  });
});
