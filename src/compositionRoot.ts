import { Disposable, ExtensionContext, Uri } from "vscode";
import type { Log } from "./core/log";
import {
  ChildrenParentParser,
  DocParser,
  ExposureParser,
  FunctionParser,
  GraphParser,
  MacroParser,
  MetricParser,
  NodeParser,
  SemanticModelParser,
  SourceParser,
  TestParser,
  UnitTestParser,
} from "./core/manifest";
import { DBTPowerUserExtension } from "./dbtPowerUserExtension";
import { ExtensionContextStore } from "./extensionContext";
import { SourceModelCreationCodeLensProvider } from "./features/codegen/sourceModelCreationCodeLensProvider";
import { CodeLensProviders } from "./features/codeLenses";
import { VSCodeCommands } from "./features/commands";
import { SqlPreviewContentProvider } from "./features/compiledSql/sqlPreviewContentProvider";
import { ContentProviders } from "./features/contentProviders";
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
import { registerDbtTaskProvider } from "./features/tasks/dbtTaskProvider";
import { TreeviewProviders } from "./features/treeViews";
import { CommandProcessExecutionFactory } from "./fusion/commandProcessExecution";
import { FusionCli } from "./fusion/fusionCli";
import { ConfiguredFusionExecutableResolver } from "./fusion/fusionExecutable";
import { DefaultFusionClientFactory } from "./fusion/fusionLanguageClient";
import { CurrentProject } from "./projects/currentProject";
import {
  createFusionClientPool,
  type FusionClientPool,
  FusionLaunchSources,
  onClientChange,
} from "./projects/fusionClientPool";
import { FusionStatus } from "./projects/fusionStatus";
import { bindExtensionOutput } from "./projects/notifications";
import { OutputChannels } from "./projects/outputChannels";
import { ParseDemand } from "./projects/parseDemand";
import { Project } from "./projects/project";
import { ProjectQuickPick } from "./projects/projectQuickPick";
import { DeclaredProject, ProjectRegistry } from "./projects/projectRegistry";
import { Projects } from "./projects/projects";
import { QueryManifestService } from "./projects/queryManifestService";
import { readProjectSnapshot } from "./projects/readProjectSnapshot";
import { RunHistoryService } from "./projects/runHistoryService";
import { schemaOriginLaunchEnv } from "./projects/schemaOrigin";
import { SharedStateService } from "./projects/sharedStateService";
import { StartupGate } from "./startupGate";

/** Builds the Project of a Declared Project. */
type ProjectFactory = (project: DeclaredProject) => Project;

/** The composed graph: the extension plus the collaborators tests inspect. */
export interface Composition {
  extension: DBTPowerUserExtension;
  extensionContextStore: ExtensionContextStore;
  fusionStatus: FusionStatus;
  fusionExecutableResolver: ConfiguredFusionExecutableResolver;
  projectFactory: ProjectFactory;
  /** The channel the client pool gives each Fusion Client of a Declared Project. */
  fusionOutputChannel: FusionLaunchSources["outputChannel"];
}

/**
 * Builds a fresh set of manifest parsers; each Project gets its own.
 * @internal
 */
export function createProjectParsers(terminal: Log) {
  return {
    childrenParentParser: new ChildrenParentParser(),
    nodeParser: new NodeParser(terminal),
    macroParser: new MacroParser(terminal),
    metricParser: new MetricParser(terminal),
    graphParser: new GraphParser(terminal),
    sourceParser: new SourceParser(terminal),
    testParser: new TestParser(terminal),
    unitTestParser: new UnitTestParser(terminal),
    exposureParser: new ExposureParser(terminal),
    functionParser: new FunctionParser(terminal),
    docParser: new DocParser(terminal),
    semanticModelParser: new SemanticModelParser(terminal),
  };
}

interface ProjectsGraph {
  extensionContextStore: ExtensionContextStore;
  outputChannels: OutputChannels;
  terminal: Log;
  sharedState: SharedStateService;
  runHistoryService: RunHistoryService;
  fusionExecutableResolver: ConfiguredFusionExecutableResolver;
  projectFactory: ProjectFactory;
  projectRegistry: ProjectRegistry;
  projects: Projects;
  projectQuickPick: ProjectQuickPick;
  currentProject: CurrentProject;
  queryManifestService: QueryManifestService;
  /** Filled by `composeFusion`; projects read their client through it. */
  clients: { pool?: FusionClientPool };
  /** Views reading parse-owned fields; projects parse on a source change only while one is showing. */
  parseDemand: ParseDemand;
}

function composeProjects(context: ExtensionContext): ProjectsGraph {
  const extensionContextStore = new ExtensionContextStore(context);
  const outputChannels = new OutputChannels(context.extension.id);
  bindExtensionOutput(() => outputChannels.channel.show(true));
  const terminal: Log = outputChannels;
  const sharedState = new SharedStateService();
  const runHistoryService = new RunHistoryService();
  const fusionExecutableResolver = new ConfiguredFusionExecutableResolver({
    logWarning: (message) => terminal.warn("FusionVersion", message),
    getGlobalState: () => ({
      get: (key) => extensionContextStore.getFromGlobalState(key),
      update: (key, value) =>
        extensionContextStore.setToGlobalState(key, value),
    }),
  });
  const clients: { pool?: FusionClientPool } = {};
  const parseDemand = new ParseDemand();
  const projectFactory: ProjectFactory = (declared) => {
    const log = outputChannels.projectLog(declared);
    const processes = new CommandProcessExecutionFactory(log);
    return new Project({
      terminal: log,
      sharedState,
      runHistoryService,
      resolver: fusionExecutableResolver,
      cliFactory: (executable, root) =>
        new FusionCli(
          executable,
          () => readProjectSnapshot(Uri.file(root)),
          processes,
          log,
        ),
      parsers: createProjectParsers(log),
      projectRoot: declared.root,
      projectCount: () => projects.all().length,
      fusionClient: () => clients.pool?.get(declared),
      clientChanged: (listener) =>
        clients.pool
          ? onClientChange(clients.pool, declared)(listener)
          : Disposable.from(),
      parseDemand,
    });
  };

  const projectRegistry = new ProjectRegistry(terminal);
  outputChannels.follow(projectRegistry);
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
    outputChannels,
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
    clients,
    parseDemand,
  };
}

function composeFusion(graph: ProjectsGraph) {
  const { projects, currentProject } = graph;
  const fusionOutputChannel: FusionLaunchSources["outputChannel"] = (
    declared,
  ) => graph.outputChannels.projectLog(declared).channel;
  const fusionClientPool = createFusionClientPool(
    graph.projectRegistry,
    graph.terminal,
    {
      resolver: graph.fusionExecutableResolver,
      factory: new DefaultFusionClientFactory(),
      readSnapshot: readProjectSnapshot,
      outputChannel: fusionOutputChannel,
      launchEnv: {
        resolve: (declared) =>
          schemaOriginLaunchEnv(projects.get(declared.root)),
        onDidChange: projects.onDidChangeManifest,
      },
      reportCompileErrors: (declared, messages) => {
        const project = projects.get(declared.root);
        project?.errors.reportCompile(messages);
        project?.notifyCompileComplete();
      },
    },
  );
  graph.clients.pool = fusionClientPool;
  const dbtLineageService = new DbtLineageService(
    graph.queryManifestService,
    () => {
      const project = currentProject.current;
      return project ? fusionClientPool.get(project) : undefined;
    },
    () => {
      const project = currentProject.current;
      return project ? projects.get(project.root)?.errors.current : undefined;
    },
    () => {
      const project = currentProject.current;
      return project ? projects.get(project.root)?.lsp : undefined;
    },
  );
  const fusionStatus = new FusionStatus(
    graph.projectRegistry,
    fusionClientPool,
    (declared) => projects.get(declared.root)?.projectOptIns(),
    (listener) =>
      Disposable.from(
        projects.onDidChangeManifest(listener),
        projects.onDidChangeErrors(listener),
      ),
    (declared) => projects.get(declared.root)?.errors.current,
  );
  return {
    fusionClientPool,
    fusionOutputChannel,
    dbtLineageService,
    fusionStatus,
  };
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
      projects.onDidRemoveProject,
    ),
    new DocsEditViewPanel(
      projects,
      extensionContextStore,
      {
        docGenService: new DocGenService(projects, queryManifestService),
        dbtTestService: new DbtTestService(queryManifestService),
        queryManifestService,
      },
      terminal,
      graph.parseDemand,
    ),
    new LineageViewProvider(lineagePanel, projects, graph.parseDemand),
  );
}

function composeCommands(graph: ProjectsGraph, startupGate: StartupGate) {
  const { projects, terminal, extensionContextStore } = graph;
  const cteProfilerService = new CteProfilerService(projects);
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
      graph.outputChannels,
    ),
    terminal,
    new DiagnosticsOutputChannel(
      graph.outputChannels.createDiagnosticsChannel(),
    ),
    graph.runHistoryService,
    cteProfilerService,
    new CteProfilerDecorationProvider(cteProfilerService, terminal),
    deferToProductionStatusBar,
    startupGate,
  );
  return { vscodeCommands, deferToProductionStatusBar };
}

function composeEditorProviders(graph: ProjectsGraph) {
  const { projects } = graph;
  return {
    treeviewProviders: new TreeviewProviders(
      new ChildrenModelTreeview(projects),
      new ParentModelTreeview(projects),
      {
        test: new ModelTestTreeview(projects),
        documentation: new DocumentationTreeview(projects),
        parseDemand: graph.parseDemand,
      },
      new RunHistoryTreeviewProvider(graph.runHistoryService),
    ),
    contentProviders: new ContentProviders(
      new SqlPreviewContentProvider(projects),
    ),
    codeLensProviders: new CodeLensProviders(
      projects,
      new SourceModelCreationCodeLensProvider(),
      new VirtualSqlCodeLensProvider(graph.queryManifestService),
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
  const editor = composeEditorProviders(graph);

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
    new ProjectConfigCommands(startupGate, currentProject, (root) =>
      graph.outputChannels.logFor(root),
    ),
    new FileAssociationsCommand(startupGate, projectRegistry),
    startupGate,
    fusion.dbtLineageService,
    graph.sharedState,
    graph.runHistoryService,
    registerDbtTaskProvider(graph.projects),
  );

  return {
    extension,
    extensionContextStore: graph.extensionContextStore,
    fusionStatus: fusion.fusionStatus,
    fusionExecutableResolver: graph.fusionExecutableResolver,
    projectFactory: graph.projectFactory,
    fusionOutputChannel: fusion.fusionOutputChannel,
  };
}
