import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { ParsedManifest } from "../../core/dbt/domain";
import { MANIFEST_FILE } from "../../core/dbt/domain";
import type { Log } from "../../core/log";
import type {
  ChildrenParentParser,
  DocParser,
  ExposureParser,
  FunctionParser,
  GraphParser,
  MacroParser,
  MetricParser,
  NodeParser,
  ParsedResourceMaps,
  SemanticModelParser,
  SourceParser,
  TestParser,
  UnitTestParser,
} from "../../core/manifest/index";
import { type ManifestProject } from "../../core/manifest/index";
import { buildRelationIndex } from "../../core/manifest/relationIndex";
import type {
  ExposureResource,
  FunctionResource,
  MacroResource,
  ManifestResources,
  SemanticModelResource,
} from "../../core/manifest/types";

/** Reports more than this many consecutive unreadable manifests as an error. */
const READ_FAILURE_REPORT_THRESHOLD = 3;

/** The parsers that turn `manifest.json` into a {@link ParsedManifest}. */
export interface ManifestParsers {
  childrenParentParser: ChildrenParentParser;
  nodeParser: NodeParser;
  macroParser: MacroParser;
  metricParser: MetricParser;
  graphParser: GraphParser;
  sourceParser: SourceParser;
  testParser: TestParser;
  unitTestParser: UnitTestParser;
  exposureParser: ExposureParser;
  functionParser: FunctionParser;
  docParser: DocParser;
  semanticModelParser: SemanticModelParser;
}

/** Consecutive manifest read failures for one project; reset by a successful read. */
export interface ManifestReadFailures {
  count: number;
}

export interface BuiltManifest {
  parsed: ParsedManifest;
  /** `metadata.adapter_type`, when the manifest carries one. */
  adapterType?: string | undefined;
}

const publicationEpochs = new Map<string, number>();
/** Distinguishes this extension-host session's epochs, which restart at 1, from an earlier session's. */
const SESSION = randomUUID();

/**
 * An id for `manifest`'s publication that no other publication, in this or any earlier extension-host session,
 * shares; a panel saves it with its view state and restores only on a match.
 */
export function publicationId(
  manifest: { publicationEpoch: number } | undefined,
): string | undefined {
  return manifest && `${SESSION}:${manifest.publicationEpoch}`;
}

/** Stamps `parsed` as the next manifest publication for `project`'s root, advancing that root's epoch. */
export function nextManifestPublication<
  P extends { projectRoot: { fsPath: string } },
>(project: P, parsed: ParsedManifest) {
  const projectKey = project.projectRoot.fsPath;
  const publicationEpoch = (publicationEpochs.get(projectKey) ?? 0) + 1;
  publicationEpochs.set(projectKey, publicationEpoch);
  return {
    ...parsed,
    publicationEpoch,
  };
}

interface ManifestJson {
  metadata?: { adapter_type?: string };
  nodes: ManifestResources;
  sources: ManifestResources;
  macros: ManifestResources<MacroResource>;
  semantic_models: ManifestResources<SemanticModelResource>;
  docs: ManifestResources;
  exposures: ManifestResources<ExposureResource>;
  functions?: ManifestResources<FunctionResource>;
  unit_tests?: ManifestResources;
}

/**
 * Reads `<targetPath>/manifest.json` and runs every parser over it.
 * Returns undefined when the file is absent or unparsable.
 */
export async function buildManifest({
  parsers,
  project,
  targetPath,
  terminal,
  readFailures,
}: {
  parsers: ManifestParsers;
  project: ManifestProject;
  targetPath: string;
  terminal: Log;
  readFailures: ManifestReadFailures;
}): Promise<BuiltManifest | undefined> {
  const projectRoot = project.getProjectRoot();
  terminal.debug(
    "Manifest",
    `Going to parse manifest for project at ${projectRoot}`,
  );
  const manifestJson = readManifestFile(
    projectRoot,
    targetPath,
    terminal,
    readFailures,
  );
  if (manifestJson === undefined) {
    return undefined;
  }
  const {
    parentMetaMap,
    childMetaMap,
    constraintOnlyParents,
    nodeMetaMap,
    macroMetaMap,
    metricMetaMap,
    semanticModelMetaMap,
    sourceMetaMap,
    testMetaMap,
    unitTestMetaMap,
    docMetaMap,
    exposureMetaMap,
    functionMetaMap,
  } = await parseResourceMaps(parsers, project, manifestJson);
  const graphMetaMap = parsers.graphParser.createGraphMetaMap({
    project,
    parentMetaMap,
    childMetaMap,
    constraintOnlyParents,
    nodeMetaMap,
    sourceMetaMap,
    testMetaMap,
    functionMetaMap,
  });
  return {
    adapterType: (manifestJson.metadata?.adapter_type ?? "") || undefined,
    parsed: {
      nodeMetaMap,
      macroMetaMap,
      metricMetaMap,
      sourceMetaMap,
      graphMetaMap,
      testMetaMap,
      unitTestMetaMap,
      docMetaMap,
      exposureMetaMap,
      functionMetaMap,
      semanticModelMetaMap,
      modelDepthMap: new Map(),
    },
  };
}

async function parseResourceMaps(
  parsers: ManifestParsers,
  project: ManifestProject,
  manifestJson: ManifestJson,
): Promise<ParsedResourceMaps> {
  const {
    nodes,
    sources,
    macros,
    semantic_models: semanticModels,
    docs,
    exposures,
    functions: functionRecords,
    unit_tests: unitTests,
  } = manifestJson;
  const [
    parentMaps,
    nodeMetaMap,
    macroMetaMap,
    metricMetaMap,
    sourceMetaMap,
    testMetaMap,
    unitTestMetaMap,
    docMetaMap,
    exposureMetaMap,
    functionMetaMap,
  ] = await Promise.all([
    parsers.childrenParentParser.createChildrenParentMetaMap(
      { ...nodes, ...exposures, ...functionRecords },
      sources,
    ),
    parsers.nodeParser.createNodeMetaMap(nodes, project),
    parsers.macroParser.createMacroMetaMap(macros, project),
    parsers.metricParser.createMetricMetaMap(semanticModels, project),
    parsers.sourceParser.createSourceMetaMap(sources, project),
    parsers.testParser.createTestMetaMap(nodes, project),
    parsers.unitTestParser.createUnitTestMetaMap(unitTests ?? {}, project),
    parsers.docParser.createDocMetaMap(docs, project),
    parsers.exposureParser.createExposureMetaMap(exposures, project),
    parsers.functionParser.createFunctionMetaMap(
      functionRecords ?? {},
      project,
    ),
  ]);
  // Semantic models resolve their `model` ref against the nodes and sources parsed above.
  const semanticModelMetaMap =
    await parsers.semanticModelParser.createSemanticModelMetaMap(
      semanticModels,
      project,
      buildRelationIndex(nodeMetaMap, sourceMetaMap),
    );
  return {
    ...parentMaps,
    nodeMetaMap,
    macroMetaMap,
    metricMetaMap,
    semanticModelMetaMap,
    sourceMetaMap,
    testMetaMap,
    unitTestMetaMap,
    docMetaMap,
    exposureMetaMap,
    functionMetaMap,
  };
}

function readManifestFile(
  projectRoot: string,
  targetPath: string,
  terminal: Log,
  readFailures: ManifestReadFailures,
): ManifestJson | undefined {
  const segments = isAbsolute(targetPath)
    ? [targetPath]
    : [projectRoot, targetPath];
  const manifestPath = join(...segments, MANIFEST_FILE);
  terminal.debug(
    "Manifest",
    `Reading manifest at ${manifestPath} for project at ${projectRoot}`,
  );
  try {
    // manifest.json stores resource maps as objects; published parser types say arrays.
    const parsed = JSON.parse(
      readFileSync(manifestPath, "utf8"),
    ) as ManifestJson;
    readFailures.count = 0;
    return parsed;
  } catch (error) {
    readFailures.count++;
    if (readFailures.count > READ_FAILURE_REPORT_THRESHOLD) {
      terminal.error(
        "Manifest",
        `Could not read/parse manifest file at ${manifestPath} after ${readFailures.count} attempts`,
        error,
      );
    }
    return undefined;
  }
}
