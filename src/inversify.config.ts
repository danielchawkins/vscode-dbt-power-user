import { Container, Factory, ResolutionContext } from "inversify";
import { Event, EventEmitter, Uri } from "vscode";
import { createFusionCommandIntegrationFactory } from "./dbt_client/configuredFusionCommandIntegration";
import { DBTProject } from "./dbt_client/dbtProject";
import { DBTProjectLog } from "./dbt_client/dbtProjectLog";
import { ManifestCacheChangedEvent } from "./dbt_client/event/manifestCacheChangedEvent";
import { ProjectConfigChangedEvent } from "./dbt_client/event/projectConfigChangedEvent";
import { FusionProjectIntegration } from "./dbt_client/fusionProjectIntegration";
import { VSCodeDBTConfiguration } from "./dbt_client/vscodeConfiguration";
import { VSCodeDBTTerminal } from "./dbt_client/vscodeTerminal";
import {
  ChildrenParentParser,
  CommandProcessExecutionFactory,
  DBTCommandFactory,
  DBTConfiguration,
  DBTTerminal,
  DeferConfig,
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
} from "./dbt_integration";
import { ConfiguredFusionExecutableResolver } from "./fusion/fusionExecutable";
import {
  createFusionClientPool,
  FusionClientPoolImpl,
} from "./lsp/fusionClientPool";
import { DefaultFusionClientFactory } from "./lsp/fusionLanguageClient";
import { FusionStatus } from "./lsp/fusionStatus";
import { ProjectContext } from "./projects/projectContext";
import { ProjectRegistry } from "./projects/projectRegistry";
import { DbtLineageService } from "./services/dbtLineageService";
import { DbtTestService } from "./services/dbtTestService";
import { DiagnosticsOutputChannel } from "./services/diagnosticsOutputChannel";
import { DocGenService } from "./services/docGenService";
import { FileService } from "./services/fileService";
import { QueryManifestService } from "./services/queryManifestService";
import { RunHistoryService } from "./services/runHistoryService";
import { SharedStateService } from "./services/sharedStateService";

// Core extension components
import { DBTProjectContainer } from "./dbt_client/dbtProjectContainer";

// Import providers
import { CodeLensProviders } from "./code_lens_provider";
import { CteCodeLensProvider } from "./code_lens_provider/cteCodeLensProvider";
import { SourceModelCreationCodeLensProvider } from "./code_lens_provider/sourceModelCreationCodeLensProvider";
import { SqlActionsCodeLensProvider } from "./code_lens_provider/sqlActionsCodeLensProvider";
import { VirtualSqlCodeLensProvider } from "./code_lens_provider/virtualSqlCodeLensProvider";
import { ProjectQuickPick } from "./quickpick/projectQuickPick";

// Import missing providers and components
import { VSCodeCommands } from "./commands";
import { ProjectSetupCommands } from "./commands/projectSetupCommands";
import { RunModel } from "./commands/runModel";
import { RunTest } from "./commands/runTest";
import { ContentProviders } from "./content_provider";
import { SqlPreviewContentProvider } from "./content_provider/sqlPreviewContentProvider";
import { CteProfilerDecorationProvider } from "./cte_profiler/cteProfilerDecorationProvider";
import { CteProfilerService } from "./cte_profiler/cteProfilerService";
import { DBTPowerUserExtension } from "./dbtPowerUserExtension";
import { DbtPowerUserActionsCenter } from "./quickpick";
import { StatusBars } from "./statusbar";
import { DeferToProductionStatusBar } from "./statusbar/deferToProductionStatusBar";
import { TreeviewProviders } from "./treeview_provider";
import {
  ChildrenModelTreeview,
  DocumentationTreeview,
  ModelTestTreeview,
  ParentModelTreeview,
} from "./treeview_provider/modelTreeviewProvider";
import { RunHistoryTreeviewProvider } from "./treeview_provider/runHistoryTreeviewProvider";
import { WebviewViewProviders } from "./webview_provider";
import { DocsEditViewPanel } from "./webview_provider/docsEditPanel";
import { LineagePanel } from "./webview_provider/lineagePanel";
import { NewLineagePanel } from "./webview_provider/newLineagePanel";
import { QueryResultPanel } from "./webview_provider/queryResultPanel";

export const container = new Container();

// Bind parser classes
container
  .bind(ChildrenParentParser)
  .toDynamicValue(() => new ChildrenParentParser());
container
  .bind(NodeParser)
  .toDynamicValue((context) => new NodeParser(context.get("DBTTerminal")));
container
  .bind(MacroParser)
  .toDynamicValue((context) => new MacroParser(context.get("DBTTerminal")));
container
  .bind(MetricParser)
  .toDynamicValue((context) => new MetricParser(context.get("DBTTerminal")));
container
  .bind(SemanticModelParser)
  .toDynamicValue(
    (context) => new SemanticModelParser(context.get("DBTTerminal")),
  );
container
  .bind(GraphParser)
  .toDynamicValue((context) => new GraphParser(context.get("DBTTerminal")));
container
  .bind(SourceParser)
  .toDynamicValue((context) => new SourceParser(context.get("DBTTerminal")));
container
  .bind(TestParser)
  .toDynamicValue((context) => new TestParser(context.get("DBTTerminal")));
container
  .bind(UnitTestParser)
  .toDynamicValue((context) => new UnitTestParser(context.get("DBTTerminal")));
container
  .bind(ExposureParser)
  .toDynamicValue((context) => new ExposureParser(context.get("DBTTerminal")));
container
  .bind(FunctionParser)
  .toDynamicValue((context) => new FunctionParser(context.get("DBTTerminal")));
container
  .bind(DocParser)
  .toDynamicValue((context) => new DocParser(context.get("DBTTerminal")));
container
  .bind(ModelDepthParser)
  .toDynamicValue(
    (context) => new ModelDepthParser(context.get("DBTTerminal")),
  );

container
  .bind(DBTCommandFactory)
  .toDynamicValue((context) => {
    return new DBTCommandFactory(context.get("DBTConfiguration"));
  })
  .inSingletonScope();

// Bind DBTConfiguration
container
  .bind<DBTConfiguration>("DBTConfiguration")
  .to(VSCodeDBTConfiguration)
  .inSingletonScope();

// Bind DBTTerminal
container
  .bind<DBTTerminal>("DBTTerminal")
  .to(VSCodeDBTTerminal)
  .inSingletonScope();

// Bind CommandProcessExecutionFactory
container
  .bind(CommandProcessExecutionFactory)
  .toDynamicValue((context) => {
    return new CommandProcessExecutionFactory(context.get("DBTTerminal"));
  })
  .inSingletonScope();

container
  .bind<Factory<FusionProjectIntegration, [string, DeferConfig | undefined]>>(
    "Factory<FusionProjectIntegration>",
  )
  .toFactory((context: ResolutionContext) => {
    return (projectRoot: string, deferConfig: DeferConfig | undefined) => {
      const container = context;
      const terminal = container.get<DBTTerminal>("DBTTerminal");
      const commandProcessExecutionFactory = container.get(
        CommandProcessExecutionFactory,
      );
      const dbtCommandFactory = container.get(DBTCommandFactory);
      return new FusionProjectIntegration(
        container.get("DBTConfiguration"),
        dbtCommandFactory,
        container.get(ConfiguredFusionExecutableResolver),
        createFusionCommandIntegrationFactory(
          commandProcessExecutionFactory,
          dbtCommandFactory,
          terminal,
        ),
        projectRoot,
        deferConfig,
        container.get(ChildrenParentParser),
        container.get(NodeParser),
        container.get(MacroParser),
        container.get(MetricParser),
        container.get(GraphParser),
        container.get(SourceParser),
        container.get(TestParser),
        container.get(UnitTestParser),
        container.get(ExposureParser),
        container.get(FunctionParser),
        container.get(DocParser),
        terminal,
        container.get(ModelDepthParser),
        container.get(SemanticModelParser),
      );
    };
  });

container
  .bind<Factory<DBTProject, [Uri, EventEmitter<ManifestCacheChangedEvent>]>>(
    "Factory<DBTProject>",
  )
  .toFactory((context: ResolutionContext) => {
    return (
      path: Uri,
      _onManifestChanged: EventEmitter<ManifestCacheChangedEvent>,
    ) => {
      const container = context;
      return new DBTProject(
        container.get("Factory<DBTProjectLog>"),
        container.get(DBTCommandFactory),
        container.get("DBTTerminal"),
        container.get(SharedStateService),
        container.get("Factory<FusionProjectIntegration>"),
        container.get(RunHistoryService),
        path,
        _onManifestChanged,
      );
    };
  });

container
  .bind<Factory<DBTProjectLog, [Event<ProjectConfigChangedEvent>]>>(
    "Factory<DBTProjectLog>",
  )
  .toFactory(() => {
    return (onProjectConfigChanged: Event<ProjectConfigChangedEvent>) => {
      return new DBTProjectLog(onProjectConfigChanged);
    };
  });

container
  .bind(DbtLineageService)
  .toDynamicValue((context) => {
    return new DbtLineageService(
      context.get("DBTTerminal"),
      context.get(QueryManifestService),
    );
  })
  .inSingletonScope();

container
  .bind(DbtTestService)
  .toDynamicValue((context) => {
    return new DbtTestService(
      context.get(QueryManifestService),
      context.get("DBTTerminal"),
    );
  })
  .inSingletonScope();

container
  .bind(DiagnosticsOutputChannel)
  .toDynamicValue(() => {
    return new DiagnosticsOutputChannel();
  })
  .inSingletonScope();

container
  .bind(DocGenService)
  .toDynamicValue((context) => {
    return new DocGenService(
      context.get(DBTProjectContainer),
      context.get(QueryManifestService),
      context.get("DBTTerminal"),
    );
  })
  .inSingletonScope();

container
  .bind(FileService)
  .toDynamicValue(() => {
    return new FileService();
  })
  .inSingletonScope();

container
  .bind(ProjectRegistry)
  .toDynamicValue((context) => {
    return new ProjectRegistry(context.get("DBTTerminal"));
  })
  .inSingletonScope();

container
  .bind(ConfiguredFusionExecutableResolver)
  .toDynamicValue((context) => {
    const terminal = context.get<DBTTerminal>("DBTTerminal");
    return new ConfiguredFusionExecutableResolver({
      logWarning: (message) => terminal.warn("FusionVersion", message, false),
      getGlobalState: () => {
        const projectContainer = context.get(DBTProjectContainer);
        return {
          get: (key) => projectContainer.getFromGlobalState(key),
          update: (key, value) => projectContainer.setToGlobalState(key, value),
        };
      },
    });
  })
  .inSingletonScope();

container
  .bind(DefaultFusionClientFactory)
  .toDynamicValue((context) => {
    return new DefaultFusionClientFactory(context.get("DBTTerminal"));
  })
  .inSingletonScope();

container
  .bind(FusionClientPoolImpl)
  .toDynamicValue((context) => {
    return createFusionClientPool(
      context.get(ProjectRegistry),
      context.get("DBTTerminal"),
      {
        resolver: context.get(ConfiguredFusionExecutableResolver),
        factory: context.get(DefaultFusionClientFactory),
      },
    );
  })
  .inSingletonScope();

container
  .bind(ProjectContext)
  .toDynamicValue((context) => {
    return new ProjectContext(
      context.get(ProjectRegistry),
      context.get(ProjectQuickPick),
    );
  })
  .inSingletonScope();

container
  .bind(QueryManifestService)
  .toDynamicValue((context) => {
    return new QueryManifestService(
      context.get(DBTProjectContainer),
      context.get("DBTTerminal"),
      context.get(ProjectContext),
    );
  })
  .inSingletonScope();

container
  .bind(SharedStateService)
  .toDynamicValue(() => {
    return new SharedStateService();
  })
  .inSingletonScope();

container
  .bind(RunHistoryService)
  .toDynamicValue(() => {
    return new RunHistoryService();
  })
  .inSingletonScope();

container
  .bind(RunHistoryTreeviewProvider)
  .toDynamicValue((context) => {
    return new RunHistoryTreeviewProvider(context.get(RunHistoryService));
  })
  .inSingletonScope();

container
  .bind(CteProfilerService)
  .toDynamicValue((context) => {
    return new CteProfilerService(
      context.get(DBTProjectContainer),
      context.get("DBTTerminal"),
    );
  })
  .inSingletonScope();

container
  .bind(CteProfilerDecorationProvider)
  .toDynamicValue((context) => {
    return new CteProfilerDecorationProvider(
      context.get(CteProfilerService),
      context.get("DBTTerminal"),
    );
  })
  .inSingletonScope();

container
  .bind(ProjectQuickPick)
  .toDynamicValue(() => {
    return new ProjectQuickPick();
  })
  .inSingletonScope();
// Bind manifest components
container
  .bind(DBTProjectContainer)
  .toDynamicValue((context) => {
    return new DBTProjectContainer(
      context.get(ProjectRegistry),
      context.get("Factory<DBTProject>"),
      context.get("DBTTerminal"),
    );
  })
  .inSingletonScope();

// Bind code lens providers
container
  .bind(CodeLensProviders)
  .toDynamicValue((context) => {
    return new CodeLensProviders(
      context.get(DBTProjectContainer),
      context.get(SourceModelCreationCodeLensProvider),
      context.get(VirtualSqlCodeLensProvider),
      context.get(CteCodeLensProvider),
      context.get(SqlActionsCodeLensProvider),
    );
  })
  .inSingletonScope();

container
  .bind(CteCodeLensProvider)
  .toDynamicValue((context) => {
    return new CteCodeLensProvider(context.get("DBTTerminal"));
  })
  .inSingletonScope();

container
  .bind(SqlActionsCodeLensProvider)
  .toDynamicValue(() => {
    return new SqlActionsCodeLensProvider();
  })
  .inSingletonScope();

container
  .bind(SourceModelCreationCodeLensProvider)
  .toDynamicValue(() => {
    return new SourceModelCreationCodeLensProvider();
  })
  .inSingletonScope();

container
  .bind(VirtualSqlCodeLensProvider)
  .toDynamicValue((context) => {
    return new VirtualSqlCodeLensProvider(context.get(QueryManifestService));
  })
  .inSingletonScope();

// Bind additional webview components
container
  .bind(SqlPreviewContentProvider)
  .toDynamicValue((context) => {
    return new SqlPreviewContentProvider(context.get(DBTProjectContainer));
  })
  .inSingletonScope();

// Bind status bar components
container
  .bind(DeferToProductionStatusBar)
  .toDynamicValue((context) => {
    return new DeferToProductionStatusBar(
      context.get(DBTProjectContainer),
      context.get("DBTTerminal"),
    );
  })
  .inSingletonScope();

container
  .bind(FusionStatus)
  .toDynamicValue((context) => {
    return new FusionStatus(
      context.get(ProjectContext),
      context.get(FusionClientPoolImpl),
    );
  })
  .inSingletonScope();

// Bind individual command components that are required by VSCodeCommands
container
  .bind(RunModel)
  .toDynamicValue((context) => {
    return new RunModel(
      context.get(DBTProjectContainer),
      context.get(ProjectContext),
    );
  })
  .inSingletonScope();

container
  .bind(RunTest)
  .toDynamicValue((context) => {
    return new RunTest(
      context.get(DBTProjectContainer),
      context.get(QueryManifestService),
    );
  })
  .inSingletonScope();

container
  .bind(ProjectSetupCommands)
  .toDynamicValue((context) => {
    return new ProjectSetupCommands(
      context.get(DBTProjectContainer),
      context.get(ProjectQuickPick),
      context.get("DBTTerminal"),
    );
  })
  .inSingletonScope();

container
  .bind(VSCodeCommands)
  .toDynamicValue((context) => {
    return new VSCodeCommands(
      context.get(DBTProjectContainer),
      context.get(RunModel),
      context.get(RunTest),
      context.get(ProjectSetupCommands),
      context.get("DBTTerminal"),
      context.get(DiagnosticsOutputChannel),
      context.get(RunHistoryService),
      context.get(CteProfilerService),
      context.get(CteProfilerDecorationProvider),
      context.get(CteCodeLensProvider),
    );
  })
  .inSingletonScope();

// Bind webview panel components
container
  .bind(QueryResultPanel)
  .toDynamicValue((context) => {
    return new QueryResultPanel(
      context.get(DBTProjectContainer),
      context.get(SharedStateService),
      context.get("DBTTerminal"),
      context.get(QueryManifestService),
    );
  })
  .inSingletonScope();

container
  .bind(DocsEditViewPanel)
  .toDynamicValue((context) => {
    return new DocsEditViewPanel(
      context.get(DBTProjectContainer),
      context.get(DocGenService),
      context.get(DbtTestService),
      context.get(QueryManifestService),
      context.get("DBTTerminal"),
      context.get(DbtLineageService),
    );
  })
  .inSingletonScope();

container
  .bind(LineagePanel)
  .toDynamicValue((context) => {
    return new LineagePanel(
      context.get(NewLineagePanel),
      context.get(DBTProjectContainer),
      context.get("DBTTerminal"),
    );
  })
  .inSingletonScope();

container
  .bind(NewLineagePanel)
  .toDynamicValue((context) => {
    return new NewLineagePanel(
      context.get(DBTProjectContainer),
      context.get("DBTTerminal"),
      context.get(DbtLineageService),
      context.get(SharedStateService),
      context.get(QueryManifestService),
    );
  })
  .inSingletonScope();

// Bind WebviewViewProviders
container
  .bind(WebviewViewProviders)
  .toDynamicValue((context) => {
    return new WebviewViewProviders(
      context.get(QueryResultPanel),
      context.get(DocsEditViewPanel),
      context.get(LineagePanel),
    );
  })
  .inSingletonScope();

// Bind treeview components
container
  .bind(ChildrenModelTreeview)
  .toDynamicValue((context) => {
    return new ChildrenModelTreeview(context.get(DBTProjectContainer));
  })
  .inSingletonScope();

container
  .bind(ParentModelTreeview)
  .toDynamicValue((context) => {
    return new ParentModelTreeview(context.get(DBTProjectContainer));
  })
  .inSingletonScope();

container
  .bind(ModelTestTreeview)
  .toDynamicValue((context) => {
    return new ModelTestTreeview(context.get(DBTProjectContainer));
  })
  .inSingletonScope();

container
  .bind(DocumentationTreeview)
  .toDynamicValue((context) => {
    return new DocumentationTreeview(context.get(DBTProjectContainer));
  })
  .inSingletonScope();

// Bind TreeviewProviders
container
  .bind(TreeviewProviders)
  .toDynamicValue((context) => {
    return new TreeviewProviders(
      context.get(ChildrenModelTreeview),
      context.get(ParentModelTreeview),
      context.get(ModelTestTreeview),
      context.get(DocumentationTreeview),
      context.get(RunHistoryTreeviewProvider),
    );
  })
  .inSingletonScope();

// Bind ContentProviders
container
  .bind(ContentProviders)
  .toDynamicValue((context) => {
    return new ContentProviders(context.get(SqlPreviewContentProvider));
  })
  .inSingletonScope();

// Bind StatusBars
container
  .bind(StatusBars)
  .toDynamicValue((context) => {
    return new StatusBars(context.get(DeferToProductionStatusBar));
  })
  .inSingletonScope();

// Bind DbtPowerUserActionsCenter
container
  .bind(DbtPowerUserActionsCenter)
  .toDynamicValue((context) => {
    return new DbtPowerUserActionsCenter(
      context.get(ProjectContext),
      context.get(DBTProjectContainer),
    );
  })
  .inSingletonScope();

// Finally, bind the main DBTPowerUserExtension
container
  .bind(DBTPowerUserExtension)
  .toDynamicValue((context) => {
    return new DBTPowerUserExtension(
      context.get(DBTProjectContainer),
      context.get(WebviewViewProviders),
      context.get(VSCodeCommands),
      context.get(TreeviewProviders),
      context.get(ContentProviders),
      context.get(CodeLensProviders),
      context.get(StatusBars),
      context.get(DbtPowerUserActionsCenter),
      context.get("DBTTerminal"),
      context.get(ProjectRegistry),
      context.get(ProjectContext),
      context.get(FusionClientPoolImpl),
      context.get(FusionStatus),
    );
  })
  .inSingletonScope();
