import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { isAbsolute, join, relative, resolve, sep } from "path";
import {
  Disposable,
  FileSystemWatcher,
  RelativePattern,
  Uri,
  workspace,
} from "vscode";
import type { Log } from "../core/log";
import {
  ChildrenParentParser,
  DocParser,
  ExposureParser,
  FunctionParser,
  GraphParser,
  MacroParser,
  type ManifestProject,
  MetricParser,
  ModelDepthParser,
  NodeParser,
  SemanticModelParser,
  SourceParser,
  TestParser,
  UnitTestParser,
} from "../core/manifest";
import { DBT_PROJECT_FILE, dbtProjectFilePath } from "../core/project";
import { MANIFEST_FILE, ParsedManifest } from "../dbt_integration/domain";

/** Delay between the last watched file event and the rebuild it triggers. */
const MANIFEST_TRIGGER_DEBOUNCE_MS = 500;

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
  modelDepthParser: ModelDepthParser;
  semanticModelParser: SemanticModelParser;
}

/** Consecutive manifest read failures for one project; reset by a successful read. */
export interface ManifestReadFailures {
  count: number;
}

export interface BuiltManifest {
  parsed: ParsedManifest;
  /** `metadata.adapter_type`, when the manifest carries one. */
  adapterType?: string;
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
    metadataProducer: "manifest" as const,
  };
}

/** A `manifest.json` resource section: resources keyed by unique id. */
type ManifestResources = Record<string, unknown>;

interface ManifestJson {
  metadata?: { adapter_type?: string };
  nodes: ManifestResources;
  sources: ManifestResources;
  macros: ManifestResources;
  semantic_models: ManifestResources;
  docs: ManifestResources;
  exposures: ManifestResources;
  functions?: ManifestResources;
  unit_tests?: ManifestResources;
}

/**
 * Reads `<targetPath>/manifest.json` and runs every parser over it.
 * Returns undefined when the file is absent or unparsable.
 */
export async function buildManifest(
  parsers: ManifestParsers,
  project: ManifestProject,
  targetPath: string,
  terminal: Log,
  readFailures: ManifestReadFailures,
): Promise<BuiltManifest | undefined> {
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
  const { nodes } = manifestJson;
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
  const modelDepthMap = parsers.modelDepthParser.createModelDepthsMap(
    nodes,
    parentMetaMap,
    childMetaMap,
  );
  const graphMetaMap = parsers.graphParser.createGraphMetaMap(
    project,
    parentMetaMap,
    childMetaMap,
    nodeMetaMap,
    sourceMetaMap,
    testMetaMap,
    functionMetaMap,
    constraintOnlyParents,
  );
  return {
    adapterType: manifestJson.metadata?.adapter_type || undefined,
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
      modelDepthMap,
    },
  };
}

async function parseResourceMaps(
  parsers: ManifestParsers,
  project: ManifestProject,
  manifestJson: ManifestJson,
) {
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
    semanticModelMetaMap,
    sourceMetaMap,
    testMetaMap,
    unitTestMetaMap,
    docMetaMap,
    exposureMetaMap,
    functionMetaMap,
  ] = await Promise.all([
    parsers.childrenParentParser.createChildrenParentMetaMap(
      { ...nodes, ...exposures, ...(functionRecords ?? {}) },
      sources,
    ),
    parsers.nodeParser.createNodeMetaMap(nodes, project),
    parsers.macroParser.createMacroMetaMap(macros, project),
    parsers.metricParser.createMetricMetaMap(semanticModels, project),
    parsers.semanticModelParser.createSemanticModelMetaMap(
      semanticModels,
      project,
    ),
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

export interface ManifestTriggerHandlers {
  /** Model, macro and seed paths; read on every event. */
  sourcePaths(): string[] | undefined;
  /** Runs after `dbt_project.yml` is created, changed or deleted. */
  onProjectFileChanged(): Promise<void>;
  /** Runs after a `.sql`, `.yml`, `.yaml` or `.csv` file under a source path changes. */
  onSourceFileChanged(): Promise<void>;
}

/** Debounced file events under one Declared Project root that call for a manifest rebuild. */
export class ManifestTrigger implements Disposable {
  private watcher?: FileSystemWatcher;
  private subscriptions: Disposable[] = [];
  private projectFileTimer?: ReturnType<typeof setTimeout>;
  private sourceFileTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly projectRoot: string,
    private readonly terminal: Log,
    private readonly handlers: ManifestTriggerHandlers,
  ) {}

  /** Starts watching; a no-op while already watching. */
  start(): void {
    if (this.watcher) {
      return;
    }
    const watcher = workspace.createFileSystemWatcher(
      new RelativePattern(this.projectRoot, "**/*.{sql,yml,yaml,csv}"),
    );
    const onEvent = (uri: Uri) => this.handle(uri.fsPath);
    this.watcher = watcher;
    this.subscriptions = [
      watcher.onDidCreate(onEvent),
      watcher.onDidChange(onEvent),
      watcher.onDidDelete(onEvent),
    ];
  }

  /** Stops watching and drops pending events. */
  stop(): void {
    clearTimeout(this.projectFileTimer);
    clearTimeout(this.sourceFileTimer);
    this.projectFileTimer = undefined;
    this.sourceFileTimer = undefined;
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.subscriptions = [];
    this.watcher?.dispose();
    this.watcher = undefined;
  }

  dispose(): void {
    this.stop();
  }

  private handle(fsPath: string): void {
    if (fsPath === dbtProjectFilePath(this.projectRoot)) {
      this.terminal.debug(
        "ManifestTrigger",
        `${DBT_PROJECT_FILE} changed in ${this.projectRoot}`,
      );
      clearTimeout(this.projectFileTimer);
      this.projectFileTimer = setTimeout(() => {
        this.projectFileTimer = undefined;
        void this.run("project config refresh", () =>
          this.handlers.onProjectFileChanged(),
        );
      }, MANIFEST_TRIGGER_DEBOUNCE_MS);
      return;
    }
    if (!this.isUnderSourcePath(fsPath)) {
      return;
    }
    this.terminal.debug("ManifestTrigger", `Source file changed: ${fsPath}`);
    clearTimeout(this.sourceFileTimer);
    this.sourceFileTimer = setTimeout(() => {
      this.sourceFileTimer = undefined;
      void this.run("manifest rebuild", () =>
        this.handlers.onSourceFileChanged(),
      );
    }, MANIFEST_TRIGGER_DEBOUNCE_MS);
  }

  private isUnderSourcePath(fsPath: string): boolean {
    return (this.handlers.sourcePaths() ?? []).some((sourcePath) => {
      const fromSource = relative(
        resolve(this.projectRoot, sourcePath),
        fsPath,
      );
      return (
        fromSource !== "" &&
        fromSource !== ".." &&
        !fromSource.startsWith(`..${sep}`) &&
        !isAbsolute(fromSource)
      );
    });
  }

  private async run(label: string, handler: () => Promise<void>) {
    try {
      await handler();
    } catch (error) {
      this.terminal.error(
        "ManifestTrigger",
        `Failed ${label} after file change in ${this.projectRoot}`,
        error,
      );
    }
  }
}
