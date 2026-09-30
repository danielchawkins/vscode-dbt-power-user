import { Event, ExtensionContext, Uri } from "vscode";
import {
  ChildrenParentParser,
  DocParser,
  ExposureParser,
  FunctionParser,
  GraphParser,
  MacroParser,
  MetricParser,
  ModelDepthParser,
  NodeParser,
  SemanticModelParser,
  SourceParser,
  TestParser,
  UnitTestParser,
} from "./core/manifest";
import { DBTProjectLog } from "./dbt_client/dbtProjectLog";
import { ProjectConfigChangedEvent } from "./dbt_client/event/projectConfigChangedEvent";
import { VSCodeDBTTerminal } from "./dbt_client/vscodeTerminal";
import { DBTTerminal } from "./dbt_integration";
import { DBTPowerUserExtension } from "./dbtPowerUserExtension";
import { ExtensionContextStore } from "./extensionContext";
import { SourceModelCreationCodeLensProvider } from "./features/codegen/sourceModelCreationCodeLensProvider";
import { CodeLensProviders } from "./features/codeLenses";
import { VSCodeCommands } from "./features/commands";
import { SqlPreviewContentProvider } from "./features/compiledSql/sqlPreviewContentProvider";
import { ContentProviders } from "./features/contentProviders";
import { CteCodeLensProvider } from "./features/cte/cteCodeLensProvider";
import { CteProfilerDecorationProvider } from "./features/cte/cteProfilerDecorationProvider";
import { CteProfilerService } from "./features/cte/cteProfilerService";
import { DeferToProductionStatusBar } from "./features/defer/deferToProductionStatusBar";
import { DiagnosticsOutputChannel } from "./features/diagnostics/diagnosticsOutputChannel";
import { DbtTestService } from "./features/docs/dbtTestService";
import { DocGenService } from "./features/docs/docGenService";
import { DocsEditViewPanel } from "./features/docs/docsEditPanel";
import { DbtLineageService } from "./features/lineage/dbtLineageService";
import { LineagePanel } from "./features/lineage/lineagePanel";
import { LineageViewProvider } from "./features/lineage/lineageViewProvider";
import {
  ChildrenModelTreeview,
  DocumentationTreeview,
  ModelTestTreeview,
  ParentModelTreeview,
} from "./features/modelTree/modelTreeviewProvider";
import { WebviewViewProviders } from "./features/panels";
import { DbtPowerUserActionsCenter } from "./features/projectPicker/actionsCenter";
import { FileAssociationsCommand } from "./features/projectSetup/fileAssociations";
import { ProjectConfigCommands } from "./features/projectSetup/projectConfigCommands";
import { ProjectSetupCommands } from "./features/projectSetup/projectSetupCommands";
import { QueryResultPanel } from "./features/queryResults/queryResultPanel";
import { RunModel } from "./features/run/runModel";
import { RunTest } from "./features/run/runTest";
import { RunHistoryTreeviewProvider } from "./features/runHistory/runHistoryTreeviewProvider";
import { SqlActionsCodeLensProvider } from "./features/sqlActions/sqlActionsCodeLensProvider";
import { VirtualSqlCodeLensProvider } from "./features/sqlActions/virtualSqlCodeLensProvider";
import { StatusBars } from "./features/statusBars";
import { TreeviewProviders } from "./features/treeViews";
import { CommandProcessExecutionFactory } from "./fusion/commandProcessExecution";
import { FusionCli } from "./fusion/fusionCli";
import { createFusionClientPool } from "./fusion/fusionClientPool";
import { ConfiguredFusionExecutableResolver } from "./fusion/fusionExecutable";
import { DefaultFusionClientFactory } from "./fusion/fusionLanguageClient";
import { FusionStatus } from "./fusion/fusionStatus";
import { schemaOriginLaunchEnv } from "./fusion/schemaOrigin";
import { CurrentProject } from "./projects/currentProject";
import { Project } from "./projects/project";
import { ProjectQuickPick } from "./projects/projectQuickPick";
import { ProjectRegistry } from "./projects/projectRegistry";
import { Projects } from "./projects/projects";
import { QueryManifestService } from "./projects/queryManifestService";
import { readProjectSnapshot } from "./projects/readProjectSnapshot";
import { RunHistoryService } from "./projects/runHistoryService";
import { SharedStateService } from "./projects/sharedStateService";
import { readEnvironmentOverride } from "./settings";
import { StartupGate } from "./startupGate";

/** Builds a Project rooted at `projectRoot`. */
export type ProjectFactory = (projectRoot: Uri) => Project;

/** Builds the log that follows a project's configuration changes. */
export type DBTProjectLogFactory = (
  onProjectConfigChanged: Event<ProjectConfigChangedEvent>,
) => DBTProjectLog;

/** The manifest parsers one Project owns. */
export type ProjectParsers = ReturnType<typeof createProjectParsers>;

/** The composed graph: the extension plus the collaborators tests inspect. */
export interface Composition {
  extension: DBTPowerUserExtension;
  extensionContextStore: ExtensionContextStore;
  fusionStatus: FusionStatus;
  fusionExecutableResolver: ConfiguredFusionExecutableResolver;
  projectFactory: ProjectFactory;
}

const readDbtLoomConfigPath = () =>
  readEnvironmentOverride("dbtLoomConfigPath");

/** Builds a fresh set of manifest parsers; each Project gets its own. */
export function createProjectParsers(terminal: DBTTerminal) {
  return {
    childrenParentParser: new ChildrenParentParser(),
    nodeParser: new NodeParser(terminal, readDbtLoomConfigPath),
    macroParser: new MacroParser(terminal),
    metricParser: new MetricParser(terminal),
    graphParser: new GraphParser(terminal),
    sourceParser: new SourceParser(terminal, readDbtLoomConfigPath),
    testParser: new TestParser(terminal),
    unitTestParser: new UnitTestParser(terminal),
    exposureParser: new ExposureParser(terminal),
    functionParser: new FunctionParser(terminal),
    docParser: new DocParser(terminal),
    modelDepthParser: new ModelDepthParser(terminal),
    semanticModelParser: new SemanticModelParser(terminal),
  };
}

interface ProjectsGraph {
  extensionContextStore: ExtensionContextStore;
  terminal: DBTTerminal;
  sharedState: SharedStateService;
  runHistoryService: RunHistoryService;
  fusionExecutableResolver: ConfiguredFusionExecutableResolver;
  projectFactory: ProjectFactory;
  projectRegistry: ProjectRegistry;
  projects: Projects;
  projectQuickPick: ProjectQuickPick;
  currentProject: CurrentProject;
  queryManifestService: QueryManifestService;
}

function composeProjects(context: ExtensionContext): ProjectsGraph {
  const extensionContextStore = new ExtensionContextStore(context);
  const terminal: DBTTerminal = new VSCodeDBTTerminal();
  const commandProcessExecutionFactory = new CommandProcessExecutionFactory(
    terminal,
  );
  const sharedState = new SharedStateService();
  const runHistoryService = new RunHistoryService();
  const fusionExecutableResolver = new ConfiguredFusionExecutableResolver({
    logWarning: (message) => terminal.warn("FusionVersion", message, false),
    getGlobalState: () => ({
      get: (key) => extensionContextStore.getFromGlobalState(key),
      update: (key, value) =>
        extensionContextStore.setToGlobalState(key, value),
    }),
  });
  const dbtProjectLogFactory: DBTProjectLogFactory = (onProjectConfigChanged) =>
    new DBTProjectLog(onProjectConfigChanged);
  const projectFactory: ProjectFactory = (projectRoot) =>
    new Project({
      dbtProjectLogFactory,
      terminal,
      sharedState,
      runHistoryService,
      resolver: fusionExecutableResolver,
      cliFactory: (executable, root) =>
        new FusionCli(
          executable,
          () => readProjectSnapshot(Uri.file(root)),
          commandProcessExecutionFactory,
          terminal,
        ),
      parsers: createProjectParsers(terminal),
      projectRoot,
    });

  const projectRegistry = new ProjectRegistry(terminal);
  const projects = new Projects(projectRegistry, projectFactory, terminal);
  const projectQuickPick = new ProjectQuickPick();
  const currentProject = new CurrentProject(projectRegistry, projectQuickPick);
  const queryManifestService = new QueryManifestService(
    projects,
    terminal,
    currentProject,
  );
  return {
    extensionContextStore,
    terminal,
    sharedState,
    runHistoryService,
    fusionExecutableResolver,
    projectFactory,
    projectRegistry,
    projects,
    projectQuickPick,
    currentProject,
    queryManifestService,
  };
}

function composeFusion(graph: ProjectsGraph) {
  const { projects, currentProject } = graph;
  const fusionClientPool = createFusionClientPool(
    graph.projectRegistry,
    graph.terminal,
    {
      resolver: graph.fusionExecutableResolver,
      factory: new DefaultFusionClientFactory(graph.terminal),
      readSnapshot: readProjectSnapshot,
      launchEnv: {
        resolve: (declared, fusionVersion) =>
          schemaOriginLaunchEnv(projects.get(declared.root), fusionVersion),
        onDidChange: projects.onDidChangeManifest,
      },
    },
  );
  const dbtLineageService = new DbtLineageService(
    graph.queryManifestService,
    () => {
      const project = currentProject.current;
      return project ? fusionClientPool.get(project) : undefined;
    },
  );
  const fusionStatus = new FusionStatus(
    graph.projectRegistry,
    fusionClientPool,
    (declared) => projects.get(declared.root)?.projectOptIns(),
    projects.onDidChangeManifest,
  );
  return { fusionClientPool, dbtLineageService, fusionStatus };
}

function composeWebviews(
  graph: ProjectsGraph,
  dbtLineageService: DbtLineageService,
): WebviewViewProviders {
  const {
    extensionContextStore,
    terminal,
    sharedState,
    projects,
    queryManifestService,
  } = graph;
  const lineagePanel = new LineagePanel(
    extensionContextStore,
    terminal,
    dbtLineageService,
    sharedState,
    queryManifestService,
  );
  return new WebviewViewProviders(
    new QueryResultPanel(
      extensionContextStore,
      sharedState,
      terminal,
      queryManifestService,
    ),
    new DocsEditViewPanel(
      projects,
      extensionContextStore,
      new DocGenService(projects, queryManifestService, terminal),
      new DbtTestService(queryManifestService, terminal),
      queryManifestService,
      terminal,
    ),
    new LineageViewProvider(lineagePanel, projects, terminal),
  );
}

function composeCommands(graph: ProjectsGraph, startupGate: StartupGate) {
  const { projects, terminal, extensionContextStore } = graph;
  const cteProfilerService = new CteProfilerService(projects, terminal);
  const cteCodeLensProvider = new CteCodeLensProvider(terminal);
  const deferToProductionStatusBar = new DeferToProductionStatusBar(
    projects,
    terminal,
  );
  const vscodeCommands = new VSCodeCommands(
    projects,
    extensionContextStore,
    new RunModel(projects, graph.currentProject),
    new RunTest(projects, graph.queryManifestService),
    new ProjectSetupCommands(
      projects,
      extensionContextStore,
      graph.projectQuickPick,
      terminal,
    ),
    terminal,
    new DiagnosticsOutputChannel(),
    graph.runHistoryService,
    cteProfilerService,
    new CteProfilerDecorationProvider(cteProfilerService, terminal),
    cteCodeLensProvider,
    deferToProductionStatusBar,
    startupGate,
  );
  return { vscodeCommands, cteCodeLensProvider, deferToProductionStatusBar };
}

function composeEditorProviders(
  graph: ProjectsGraph,
  cteCodeLensProvider: CteCodeLensProvider,
) {
  const { projects } = graph;
  return {
    treeviewProviders: new TreeviewProviders(
      new ChildrenModelTreeview(projects),
      new ParentModelTreeview(projects),
      new ModelTestTreeview(projects),
      new DocumentationTreeview(projects),
      new RunHistoryTreeviewProvider(graph.runHistoryService),
    ),
    contentProviders: new ContentProviders(
      new SqlPreviewContentProvider(projects),
    ),
    codeLensProviders: new CodeLensProviders(
      projects,
      new SourceModelCreationCodeLensProvider(),
      new VirtualSqlCodeLensProvider(graph.queryManifestService),
      cteCodeLensProvider,
      new SqlActionsCodeLensProvider(),
    ),
  };
}

/** Constructs the extension's object graph for one activation. */
export function compose(context: ExtensionContext): Composition {
  const graph = composeProjects(context);
  const { terminal, projectRegistry, currentProject } = graph;
  const fusion = composeFusion(graph);
  const startupGate = new StartupGate();
  const commands = composeCommands(graph, startupGate);
  const editor = composeEditorProviders(graph, commands.cteCodeLensProvider);

  const extension = new DBTPowerUserExtension(
    graph.projects,
    composeWebviews(graph, fusion.dbtLineageService),
    commands.vscodeCommands,
    editor.treeviewProviders,
    editor.contentProviders,
    editor.codeLensProviders,
    new StatusBars(commands.deferToProductionStatusBar),
    new DbtPowerUserActionsCenter(currentProject, graph.extensionContextStore),
    terminal,
    projectRegistry,
    currentProject,
    fusion.fusionClientPool,
    fusion.fusionStatus,
    new ProjectConfigCommands(startupGate, currentProject, terminal),
    new FileAssociationsCommand(startupGate, projectRegistry),
    startupGate,
    fusion.dbtLineageService,
    graph.sharedState,
    graph.runHistoryService,
  );

  return {
    extension,
    extensionContextStore: graph.extensionContextStore,
    fusionStatus: fusion.fusionStatus,
    fusionExecutableResolver: graph.fusionExecutableResolver,
    projectFactory: graph.projectFactory,
  };
}
