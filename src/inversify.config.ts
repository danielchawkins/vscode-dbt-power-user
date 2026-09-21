import {
  AltimateHttpClient,
  ChildrenParentParser,
  CLIDBTCommandExecutionStrategy,
  CommandProcessExecutionFactory,
  DBTCloudDetection,
  DBTCloudProjectDetection,
  DBTCloudProjectIntegration,
  DbtCloudVariantDetector,
  DBTCommandExecutionInfrastructure,
  DBTCommandExecutionStrategy,
  DBTCommandFactory,
  DBTConfiguration,
  DBTCoreCommandDetection,
  DBTCoreCommandProjectDetection,
  DBTCoreCommandProjectIntegration,
  DBTCoreDetection,
  DBTCoreProjectDetection,
  DBTCoreProjectIntegration,
  DBTDetection,
  DBTDiagnosticData,
  DBTFusionCommandProjectDetection,
  DBTFusionCommandProjectIntegration,
  DbtIntegrationClient,
  DBTProjectDetection,
  DBTProjectIntegrationAdapter,
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
  PythonDBTCommandExecutionStrategy,
  PythonEnvironmentProvider,
  RuntimePythonEnvironment,
  SemanticModelParser,
  SourceParser,
  TestParser,
  UnitTestParser,
} from "@altimateai/dbt-integration";
import { Container, Factory, ResolutionContext } from "inversify";
import {
  Event,
  EventEmitter,
  Memento,
  Uri,
  type WorkspaceFolder,
} from "vscode";
import { AltimateRequest } from "./altimate";
import { DBTProject } from "./dbt_client/dbtProject";
import { ProjectRegisteredUnregisteredEvent } from "./dbt_client/dbtProjectContainer";
import { DBTProjectLog } from "./dbt_client/dbtProjectLog";
import { DBTWorkspaceFolder } from "./dbt_client/dbtWorkspaceFolder";
import { ManifestCacheChangedEvent } from "./dbt_client/event/manifestCacheChangedEvent";
import { ProjectConfigChangedEvent } from "./dbt_client/event/projectConfigChangedEvent";
import { PythonEnvironment } from "./dbt_client/pythonEnvironment";
import {
  StaticRuntimePythonEnvironment,
  VSCodeRuntimePythonEnvironmentProvider,
} from "./dbt_client/runtimePythonEnvironmentProvider";
import { VSCodeDBTConfiguration } from "./dbt_client/vscodeConfiguration";
import { VSCodeDBTTerminal } from "./dbt_client/vscodeTerminal";
import { FusionVersionDetection } from "./fusion/fusionVersionDetection";
import { AltimateAuthService } from "./services/altimateAuthService";
import { DbtLineageService } from "./services/dbtLineageService";
import { DbtTestService } from "./services/dbtTestService";
import { DiagnosticsOutputChannel } from "./services/diagnosticsOutputChannel";
import { DocGenService } from "./services/docGenService";
import { FileService } from "./services/fileService";
import { QueryManifestService } from "./services/queryManifestService";
import { RunHistoryService } from "./services/runHistoryService";
import { SharedStateService } from "./services/sharedStateService";

import { ValidationProvider } from "./validation_provider";

// Core extension components
import { DBTClient } from "./dbt_client";
import { DBTProjectContainer } from "./dbt_client/dbtProjectContainer";

// Import providers
import { AutocompletionProviders } from "./autocompletion_provider";
import { DocAutocompletionProvider } from "./autocompletion_provider/docAutocompletionProvider";
import { MacroAutocompletionProvider } from "./autocompletion_provider/macroAutocompletionProvider";
import { ModelAutocompletionProvider } from "./autocompletion_provider/modelAutocompletionProvider";
import { SourceAutocompletionProvider } from "./autocompletion_provider/sourceAutocompletionProvider";
import { CodeLensProviders } from "./code_lens_provider";
import { CteCodeLensProvider } from "./code_lens_provider/cteCodeLensProvider";
import { SourceModelCreationCodeLensProvider } from "./code_lens_provider/sourceModelCreationCodeLensProvider";
import { SqlActionsCodeLensProvider } from "./code_lens_provider/sqlActionsCodeLensProvider";
import { VirtualSqlCodeLensProvider } from "./code_lens_provider/virtualSqlCodeLensProvider";
import { DefinitionProviders } from "./definition_provider";
import { DocDefinitionProvider } from "./definition_provider/docDefinitionProvider";
import { MacroDefinitionProvider } from "./definition_provider/macroDefinitionProvider";
import { ModelDefinitionProvider } from "./definition_provider/modelDefinitionProvider";
import { SourceDefinitionProvider } from "./definition_provider/sourceDefinitionProvider";
import { HoverProviders } from "./hover_provider";
import { DepthDecorationProvider } from "./hover_provider/depthDecorationProvider";
import { MacroHoverProvider } from "./hover_provider/macroHoverProvider";
import { ModelHoverProvider } from "./hover_provider/modelHoverProvider";
import { SourceHoverProvider } from "./hover_provider/sourceHoverProvider";
import { YamlModelHoverProvider } from "./hover_provider/yamlModelHoverProvider";
import { ProjectQuickPick } from "./quickpick/projectQuickPick";

// Import missing providers and components
import { VSCodeCommands } from "./commands";
import { RunModel } from "./commands/runModel";
import { RunTest } from "./commands/runTest";
import { ValidateSql } from "./commands/validateSql";
import { WalkthroughCommands } from "./commands/walkthroughCommands";
import { ContentProviders } from "./content_provider";
import { SqlPreviewContentProvider } from "./content_provider/sqlPreviewContentProvider";
import { CteProfilerDecorationProvider } from "./cte_profiler/cteProfilerDecorationProvider";
import { CteProfilerService } from "./cte_profiler/cteProfilerService";
import { DBTPowerUserExtension } from "./dbtPowerUserExtension";
import { DocumentFormattingEditProviders } from "./document_formatting_edit_provider";
import { DbtDocumentFormattingEditProvider } from "./document_formatting_edit_provider/dbtDocumentFormattingEditProvider";
import { SqlFmtAvailabilityNotifier } from "./document_formatting_edit_provider/sqlfmtAvailabilityNotifier";
import { DbtPowerUserActionsCenter } from "./quickpick";
import { DbtPowerUserControlCenterAction } from "./quickpick/actionsQuickPick";
import { StatusBars } from "./statusbar";
import { DeferToProductionStatusBar } from "./statusbar/deferToProductionStatusBar";
import { TargetStatusBar } from "./statusbar/targetStatusBar";
import { VersionStatusBar } from "./statusbar/versionStatusBar";
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
import { OnboardingPanel } from "./webview_provider/onboardingPanel";
import { QueryResultPanel } from "./webview_provider/queryResultPanel";
import { WhatsNewPanel } from "./webview_provider/whatsNewPanel";

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
    (context) =>
      new ModelDepthParser(
        context.get("DBTTerminal"),
        context.get(DbtIntegrationClient),
        context.get("DBTConfiguration"),
      ),
  );

// Bind core dbt integration classes using factory functions
container
  .bind(CLIDBTCommandExecutionStrategy)
  .toDynamicValue(() => {
    // Note: CLIDBTCommandExecutionStrategy requires projectRoot and dbtPath at construction time
    // These will be provided by the factory functions that create instances
    throw new Error(
      "CLIDBTCommandExecutionStrategy should be created via Factory<CLIDBTCommandExecutionStrategy>",
    );
  })
  .inSingletonScope();

container
  .bind<Factory<PythonDBTCommandExecutionStrategy, [string]>>(
    "Factory<PythonDBTCommandExecutionStrategy>",
  )
  .toFactory((context: ResolutionContext) => {
    return (projectRoot: string) => {
      const container = context;
      const baseConfig = container.get<DBTConfiguration>("DBTConfiguration");
      // Create a per-project config that returns the correct working directory
      // so that PythonDBTCommandExecutionStrategy resolves the right .env file
      const projectConfig = Object.create(baseConfig) as DBTConfiguration;
      projectConfig.getWorkingDirectory = () => projectRoot;
      return new PythonDBTCommandExecutionStrategy(
        container.get(CommandProcessExecutionFactory),
        container.get("RuntimePythonEnvironment"),
        container.get("DBTTerminal"),
        projectConfig,
      );
    };
  });

container.bind(DBTCommandExecutionInfrastructure).toDynamicValue((context) => {
  return new DBTCommandExecutionInfrastructure(
    context.get("RuntimePythonEnvironment"),
    context.get("DBTTerminal"),
  );
});

container
  .bind(DBTCommandFactory)
  .toDynamicValue((context) => {
    return new DBTCommandFactory(context.get("DBTConfiguration"));
  })
  .inSingletonScope();

container
  .bind(DbtCloudVariantDetector)
  .toDynamicValue((context) => {
    return new DbtCloudVariantDetector(context.get("DBTTerminal"));
  })
  .inSingletonScope();

// Bind dbt core integration classes using factory functions
container
  .bind(DBTCoreDetection)
  .toDynamicValue((context) => {
    return new DBTCoreDetection(
      context.get("RuntimePythonEnvironment"),
      context.get(CommandProcessExecutionFactory),
      context.get("DBTTerminal"),
    );
  })
  .inSingletonScope();

container
  .bind(DBTCoreProjectDetection)
  .toDynamicValue((context) => {
    return new DBTCoreProjectDetection(
      context.get(DBTCommandExecutionInfrastructure),
      context.get("DBTTerminal"),
    );
  })
  .inSingletonScope();

// Note: DBTCoreProjectIntegration requires projectRoot at construction time
// It will be created via Factory<DBTCoreProjectIntegration>
container
  .bind(DBTCoreProjectIntegration)
  .toDynamicValue(() => {
    throw new Error(
      "DBTCoreProjectIntegration should be created via Factory<DBTCoreProjectIntegration>",
    );
  })
  .inSingletonScope();

// Bind dbt cloud integration classes using factory functions
container
  .bind(DBTCloudDetection)
  .toDynamicValue((context) => {
    return new DBTCloudDetection(
      context.get(CommandProcessExecutionFactory),
      context.get("RuntimePythonEnvironment"),
      context.get("DBTTerminal"),
    );
  })
  .inSingletonScope();

container
  .bind(DBTCloudProjectDetection)
  .toDynamicValue(() => {
    return new DBTCloudProjectDetection();
  })
  .inSingletonScope();

// Note: DBTCloudProjectIntegration requires projectRoot at construction time
// It will be created via Factory<DBTCloudProjectIntegration>
container
  .bind(DBTCloudProjectIntegration)
  .toDynamicValue(() => {
    throw new Error(
      "DBTCloudProjectIntegration should be created via Factory<DBTCloudProjectIntegration>",
    );
  })
  .inSingletonScope();

container
  .bind(DBTFusionCommandProjectDetection)
  .toDynamicValue(() => {
    return new DBTFusionCommandProjectDetection();
  })
  .inSingletonScope();

// Note: DBTFusionCommandProjectIntegration requires projectRoot at construction time
// It will be created via Factory<DBTFusionCommandProjectIntegration>
container
  .bind(DBTFusionCommandProjectIntegration)
  .toDynamicValue(() => {
    throw new Error(
      "DBTFusionCommandProjectIntegration should be created via Factory<DBTFusionCommandProjectIntegration>",
    );
  })
  .inSingletonScope();

// Bind dbt core command integration classes using factory functions
container
  .bind(DBTCoreCommandDetection)
  .toDynamicValue((context) => {
    return new DBTCoreCommandDetection(
      context.get("RuntimePythonEnvironment"),
      context.get(CommandProcessExecutionFactory),
    );
  })
  .inSingletonScope();

container
  .bind(DBTCoreCommandProjectDetection)
  .toDynamicValue((context) => {
    return new DBTCoreCommandProjectDetection(
      context.get(DBTCommandExecutionInfrastructure),
      context.get("DBTTerminal"),
    );
  })
  .inSingletonScope();

// Note: DBTCoreCommandProjectIntegration requires projectRoot at construction time
// It will be created via Factory<DBTCoreCommandProjectIntegration>
container
  .bind(DBTCoreCommandProjectIntegration)
  .toDynamicValue(() => {
    throw new Error(
      "DBTCoreCommandProjectIntegration should be created via Factory<DBTCoreCommandProjectIntegration>",
    );
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

// Bind RuntimePythonEnvironment (VSCode-free version for dbt_integration)
container
  .bind<RuntimePythonEnvironment>("RuntimePythonEnvironment")
  .to(StaticRuntimePythonEnvironment)
  .inSingletonScope();

// Bind PythonEnvironmentProvider
container
  .bind<PythonEnvironmentProvider>("PythonEnvironmentProvider")
  .to(VSCodeRuntimePythonEnvironmentProvider)
  .inSingletonScope();

// Bind CommandProcessExecutionFactory
container
  .bind(CommandProcessExecutionFactory)
  .toDynamicValue((context) => {
    return new CommandProcessExecutionFactory(context.get("DBTTerminal"));
  })
  .inSingletonScope();

// Bind AltimateHttpClient
container
  .bind(AltimateHttpClient)
  .toDynamicValue((context) => {
    return new AltimateHttpClient(
      context.get("DBTTerminal"),
      context.get("DBTConfiguration"),
    );
  })
  .inSingletonScope();

// Bind DbtIntegrationClient
container
  .bind(DbtIntegrationClient)
  .toDynamicValue((context) => {
    return new DbtIntegrationClient(
      context.get(AltimateHttpClient),
      context.get("DBTTerminal"),
    );
  })
  .inSingletonScope();

// Bind AltimateRequest
container
  .bind(AltimateRequest)
  .toDynamicValue((context) => {
    return new AltimateRequest(
      context.get("DBTTerminal"),
      context.get("DBTConfiguration"),
      context.get(AltimateHttpClient),
    );
  })
  .inSingletonScope();

container
  .bind<Factory<DBTDetection, [Memento | undefined]>>("Factory<DBTDetection>")
  .toFactory((context: ResolutionContext) => {
    return (globalState: Memento | undefined) => {
      const container = context;
      return new FusionVersionDetection(
        container.get(CommandProcessExecutionFactory),
        container.get("DBTTerminal"),
        container.get("DBTConfiguration"),
        globalState,
      );
    };
  });

container
  .bind<Factory<DBTProjectDetection, []>>("Factory<DBTProjectDetection>")
  .toFactory((context: ResolutionContext) => {
    return () => {
      return context.get(DBTFusionCommandProjectDetection);
    };
  });

container
  .bind<
    Factory<
      DBTWorkspaceFolder,
      [
        WorkspaceFolder,
        EventEmitter<ManifestCacheChangedEvent>,
        EventEmitter<ProjectRegisteredUnregisteredEvent>,
      ]
    >
  >("Factory<DBTWorkspaceFolder>")
  .toFactory((context: ResolutionContext) => {
    return (
      workspaceFolder: WorkspaceFolder,
      _onManifestChanged: EventEmitter<ManifestCacheChangedEvent>,
      _onProjectRegisteredUnregistered: EventEmitter<ProjectRegisteredUnregisteredEvent>,
    ) => {
      const container = context;
      return new DBTWorkspaceFolder(
        container.get("Factory<DBTProject>"),
        container.get("Factory<DBTProjectDetection>"),
        container.get("DBTTerminal"),
        workspaceFolder,
        _onManifestChanged,
        _onProjectRegisteredUnregistered,
      );
    };
  });

container
  .bind<Factory<DBTCommandExecutionStrategy, [string, string]>>(
    "Factory<CLIDBTCommandExecutionStrategy>",
  )
  .toFactory((context: ResolutionContext) => {
    return (projectRoot: string, dbtPath: string) => {
      const container = context;
      return new CLIDBTCommandExecutionStrategy(
        container.get(CommandProcessExecutionFactory),
        container.get("RuntimePythonEnvironment"),
        container.get("DBTTerminal"),
        projectRoot,
        dbtPath,
      );
    };
  });

container
  .bind<
    Factory<
      DBTCoreProjectIntegration,
      [string, DBTDiagnosticData[], DeferConfig, () => void]
    >
  >("Factory<DBTCoreProjectIntegration>")
  .toFactory((context: ResolutionContext) => {
    return (
      projectRoot: string,
      projectConfigDiagnostics: DBTDiagnosticData[],
      deferConfig: DeferConfig,
      onDiagnosticsChanged: () => void,
    ) => {
      const container = context;
      const pythonStrategyFactory = container.get<
        (projectRoot: string) => PythonDBTCommandExecutionStrategy
      >("Factory<PythonDBTCommandExecutionStrategy>");
      return new DBTCoreProjectIntegration(
        container.get(DBTCommandExecutionInfrastructure),
        container.get("RuntimePythonEnvironment"),
        container.get("PythonEnvironmentProvider"),
        pythonStrategyFactory(projectRoot),
        container.get("Factory<CLIDBTCommandExecutionStrategy>"),
        container.get("DBTTerminal"),
        container.get("DBTConfiguration"),
        container.get(DbtIntegrationClient),
        projectRoot,
        projectConfigDiagnostics,
        deferConfig,
        onDiagnosticsChanged,
      );
    };
  });

container
  .bind<
    Factory<
      DBTCoreProjectIntegration,
      [string, DBTDiagnosticData[], DeferConfig, () => void]
    >
  >("Factory<DBTCoreCommandProjectIntegration>")
  .toFactory((context: ResolutionContext) => {
    return (
      projectRoot: string,
      projectConfigDiagnostics: DBTDiagnosticData[],
      deferConfig: DeferConfig,
      onDiagnosticsChanged: () => void,
    ) => {
      const container = context;
      const pythonStrategyFactory = container.get<
        (projectRoot: string) => PythonDBTCommandExecutionStrategy
      >("Factory<PythonDBTCommandExecutionStrategy>");
      return new DBTCoreCommandProjectIntegration(
        container.get(DBTCommandExecutionInfrastructure),
        container.get("RuntimePythonEnvironment"),
        container.get("PythonEnvironmentProvider"),
        pythonStrategyFactory(projectRoot),
        container.get("Factory<CLIDBTCommandExecutionStrategy>"),
        container.get("DBTTerminal"),
        container.get("DBTConfiguration"),
        container.get(DbtIntegrationClient),
        projectRoot,
        projectConfigDiagnostics,
        deferConfig,
        onDiagnosticsChanged,
      );
    };
  });

container
  .bind<
    Factory<
      DBTFusionCommandProjectIntegration,
      [string, DBTDiagnosticData[], DeferConfig, () => void]
    >
  >("Factory<DBTFusionCommandProjectIntegration>")
  .toFactory((context: ResolutionContext) => {
    return (
      projectRoot: string,
      projectConfigDiagnostics: DBTDiagnosticData[],
      deferConfig: DeferConfig,
      onDiagnosticsChanged: () => void,
    ) => {
      const container = context;
      return new DBTFusionCommandProjectIntegration(
        container.get(DBTCommandExecutionInfrastructure),
        container.get(DBTCommandFactory),
        container.get("Factory<CLIDBTCommandExecutionStrategy>"),
        container.get("RuntimePythonEnvironment"),
        container.get("PythonEnvironmentProvider"),
        container.get("DBTTerminal"),
        projectRoot,
        projectConfigDiagnostics,
        deferConfig,
        onDiagnosticsChanged,
      );
    };
  });

container
  .bind<
    Factory<
      DBTCloudProjectIntegration,
      [string, DBTDiagnosticData[], DeferConfig, () => void]
    >
  >("Factory<DBTCloudProjectIntegration>")
  .toFactory((context: ResolutionContext) => {
    return (
      projectRoot: string,
      projectConfigDiagnostics: DBTDiagnosticData[],
      deferConfig: DeferConfig,
      onDiagnosticsChanged: () => void,
    ) => {
      const container = context;
      const pythonStrategyFactory = container.get<
        (projectRoot: string) => PythonDBTCommandExecutionStrategy
      >("Factory<PythonDBTCommandExecutionStrategy>");
      return new DBTCloudProjectIntegration(
        container.get(DBTCommandExecutionInfrastructure),
        container.get(DBTCommandFactory),
        container.get("Factory<CLIDBTCommandExecutionStrategy>"),
        container.get("RuntimePythonEnvironment"),
        container.get("PythonEnvironmentProvider"),
        container.get("DBTTerminal"),
        projectRoot,
        projectConfigDiagnostics,
        deferConfig,
        onDiagnosticsChanged,
        container.get(DbtCloudVariantDetector),
        {
          pythonDBTCommandExecutionStrategy: pythonStrategyFactory(projectRoot),
          dbtConfiguration: container.get<DBTConfiguration>("DBTConfiguration"),
          dbtIntegrationClient: container.get(DbtIntegrationClient),
        },
      );
    };
  });

container
  .bind<
    Factory<DBTProjectIntegrationAdapter, [string, DeferConfig | undefined]>
  >("Factory<DBTProjectIntegrationAdapter>")
  .toFactory((context: ResolutionContext) => {
    return (projectRoot: string, deferConfig: DeferConfig | undefined) => {
      const container = context;
      return new DBTProjectIntegrationAdapter(
        container.get("DBTConfiguration"),
        container.get(DBTCommandFactory),
        container.get("Factory<DBTCoreProjectIntegration>"),
        container.get("Factory<DBTCloudProjectIntegration>"),
        container.get("Factory<DBTFusionCommandProjectIntegration>"),
        container.get("Factory<DBTCoreCommandProjectIntegration>"),
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
        container.get("DBTTerminal"),
        container.get(ModelDepthParser),
        container.get(SemanticModelParser),
      );
    };
  });

container
  .bind<
    Factory<DBTProject, [Uri, any, EventEmitter<ManifestCacheChangedEvent>]>
  >("Factory<DBTProject>")
  .toFactory((context: ResolutionContext) => {
    return (
      path: Uri,
      projectConfig: any,
      _onManifestChanged: EventEmitter<ManifestCacheChangedEvent>,
    ) => {
      const container = context;
      return new DBTProject(
        container.get(PythonEnvironment),
        container.get("Factory<DBTProjectLog>"),
        container.get(DBTCommandFactory),
        container.get("DBTTerminal"),
        container.get(SharedStateService),
        container.get(DBTCommandExecutionInfrastructure),
        container.get("Factory<DBTProjectIntegrationAdapter>"),
        container.get(AltimateRequest),
        container.get(ValidationProvider),
        container.get(AltimateAuthService),
        container.get(RunHistoryService),
        path,
        projectConfig,
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

// Bind services
container
  .bind(AltimateAuthService)
  .toDynamicValue((context) => {
    return new AltimateAuthService(context.get("DBTConfiguration"));
  })
  .inSingletonScope();

container
  .bind(DbtLineageService)
  .toDynamicValue((context) => {
    return new DbtLineageService(
      context.get(AltimateRequest),
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
  .bind(QueryManifestService)
  .toDynamicValue((context) => {
    return new QueryManifestService(
      context.get(DBTProjectContainer),
      context.get("DBTTerminal"),
      context.get(SharedStateService),
      context.get(ProjectQuickPick),
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

container
  .bind(ValidationProvider)
  .toDynamicValue((context) => {
    return new ValidationProvider(
      context.get(AltimateRequest),
      context.get(AltimateAuthService),
    );
  })
  .inSingletonScope();

// Bind manifest components
container
  .bind(PythonEnvironment)
  .toDynamicValue((context) => {
    return new PythonEnvironment(context.get("DBTTerminal"));
  })
  .inSingletonScope();

container
  .bind(DBTProjectContainer)
  .toDynamicValue((context) => {
    return new DBTProjectContainer(
      context.get(DBTClient),
      context.get("Factory<DBTWorkspaceFolder>"),
      context.get("DBTTerminal"),
    );
  })
  .inSingletonScope();

// Bind dbt client
container
  .bind(DBTClient)
  .toDynamicValue((context) => {
    return new DBTClient(
      context.get(PythonEnvironment),
      context.get("Factory<DBTDetection>"),
    );
  })
  .inSingletonScope();

// Bind autocompletion providers
container
  .bind(AutocompletionProviders)
  .toDynamicValue((context) => {
    return new AutocompletionProviders(
      context.get(MacroAutocompletionProvider),
      context.get(ModelAutocompletionProvider),
      context.get(SourceAutocompletionProvider),
      context.get(DocAutocompletionProvider),
    );
  })
  .inSingletonScope();

container
  .bind(DocAutocompletionProvider)
  .toDynamicValue((context) => {
    return new DocAutocompletionProvider(context.get(DBTProjectContainer));
  })
  .inSingletonScope();

container
  .bind(MacroAutocompletionProvider)
  .toDynamicValue((context) => {
    return new MacroAutocompletionProvider(context.get(DBTProjectContainer));
  })
  .inSingletonScope();

container
  .bind(ModelAutocompletionProvider)
  .toDynamicValue((context) => {
    return new ModelAutocompletionProvider(context.get(DBTProjectContainer));
  })
  .inSingletonScope();

container
  .bind(SourceAutocompletionProvider)
  .toDynamicValue((context) => {
    return new SourceAutocompletionProvider(context.get(DBTProjectContainer));
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
    return new VirtualSqlCodeLensProvider(
      context.get(DBTProjectContainer),
      context.get(QueryManifestService),
    );
  })
  .inSingletonScope();

// Bind definition providers
container
  .bind(DefinitionProviders)
  .toDynamicValue((context) => {
    return new DefinitionProviders(
      context.get(ModelDefinitionProvider),
      context.get(MacroDefinitionProvider),
      context.get(SourceDefinitionProvider),
      context.get(DocDefinitionProvider),
    );
  })
  .inSingletonScope();

container
  .bind(DocDefinitionProvider)
  .toDynamicValue((context) => {
    return new DocDefinitionProvider(context.get(DBTProjectContainer));
  })
  .inSingletonScope();

container
  .bind(MacroDefinitionProvider)
  .toDynamicValue((context) => {
    return new MacroDefinitionProvider(context.get(DBTProjectContainer));
  })
  .inSingletonScope();

container
  .bind(ModelDefinitionProvider)
  .toDynamicValue((context) => {
    return new ModelDefinitionProvider(
      context.get(DBTProjectContainer),
      context.get("DBTTerminal"),
    );
  })
  .inSingletonScope();

container
  .bind(SourceDefinitionProvider)
  .toDynamicValue((context) => {
    return new SourceDefinitionProvider(context.get(DBTProjectContainer));
  })
  .inSingletonScope();

// Bind hover providers
container
  .bind(HoverProviders)
  .toDynamicValue((context) => {
    return new HoverProviders(
      context.get(ModelHoverProvider),
      context.get(SourceHoverProvider),
      context.get(MacroHoverProvider),
      context.get(DepthDecorationProvider),
      context.get(YamlModelHoverProvider),
    );
  })
  .inSingletonScope();

container
  .bind(DepthDecorationProvider)
  .toDynamicValue((context) => {
    return new DepthDecorationProvider(context.get(DBTProjectContainer));
  })
  .inSingletonScope();

container
  .bind(MacroHoverProvider)
  .toDynamicValue((context) => {
    return new MacroHoverProvider(
      context.get("DBTTerminal"),
      context.get(QueryManifestService),
    );
  })
  .inSingletonScope();

container
  .bind(ModelHoverProvider)
  .toDynamicValue((context) => {
    return new ModelHoverProvider(
      context.get(DBTProjectContainer),
      context.get("DBTTerminal"),
    );
  })
  .inSingletonScope();

container
  .bind(SourceHoverProvider)
  .toDynamicValue((context) => {
    return new SourceHoverProvider(context.get(DBTProjectContainer));
  })
  .inSingletonScope();

container
  .bind(YamlModelHoverProvider)
  .toDynamicValue((context) => {
    return new YamlModelHoverProvider(context.get(DBTProjectContainer));
  })
  .inSingletonScope();

// Bind additional webview components
container
  .bind(SqlPreviewContentProvider)
  .toDynamicValue((context) => {
    return new SqlPreviewContentProvider(context.get(DBTProjectContainer));
  })
  .inSingletonScope();

container
  .bind(DbtDocumentFormattingEditProvider)
  .toDynamicValue((context) => {
    return new DbtDocumentFormattingEditProvider(
      context.get(CommandProcessExecutionFactory),
      context.get(PythonEnvironment),
    );
  })
  .inSingletonScope();

container
  .bind(SqlFmtAvailabilityNotifier)
  .toDynamicValue((context) => {
    return new SqlFmtAvailabilityNotifier(
      context.get(DBTProjectContainer),
      context.get(DbtDocumentFormattingEditProvider),
      context.get(PythonEnvironment),
      context.get(CommandProcessExecutionFactory),
    );
  })
  .inSingletonScope();

// Bind status bar components
container
  .bind(VersionStatusBar)
  .toDynamicValue((context) => {
    return new VersionStatusBar(context.get(DBTProjectContainer));
  })
  .inSingletonScope();

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
  .bind(TargetStatusBar)
  .toDynamicValue((context) => {
    return new TargetStatusBar(
      context.get(DBTProjectContainer),
      context.get("DBTTerminal"),
    );
  })
  .inSingletonScope();

// Bind quick pick components
container
  .bind(DbtPowerUserControlCenterAction)
  .toDynamicValue(() => {
    return new DbtPowerUserControlCenterAction();
  })
  .inSingletonScope();

// Bind individual command components that are required by VSCodeCommands
container
  .bind(RunModel)
  .toDynamicValue((context) => {
    return new RunModel(context.get(DBTProjectContainer));
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
  .bind(ValidateSql)
  .toDynamicValue((context) => {
    return new ValidateSql(
      context.get(DBTProjectContainer),
      context.get(AltimateRequest),
      context.get("DBTTerminal"),
    );
  })
  .inSingletonScope();

container
  .bind(WalkthroughCommands)
  .toDynamicValue((context) => {
    return new WalkthroughCommands(
      context.get(DBTProjectContainer),
      context.get(CommandProcessExecutionFactory),
      context.get(PythonEnvironment),
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
      context.get(ValidateSql),
      context.get(WalkthroughCommands),
      context.get("DBTTerminal"),
      context.get(DiagnosticsOutputChannel),
      context.get(SharedStateService),
      context.get(PythonEnvironment),
      context.get(DBTClient),
      context.get(AltimateRequest),
      context.get(RunHistoryService),
      context.get(CteProfilerService),
      context.get(CteProfilerDecorationProvider),
      context.get(CteCodeLensProvider),
      context.get(WhatsNewPanel),
    );
  })
  .inSingletonScope();

// Bind webview panel components
container
  .bind(QueryResultPanel)
  .toDynamicValue((context) => {
    return new QueryResultPanel(
      context.get(DBTProjectContainer),
      context.get(AltimateRequest),
      context.get(SharedStateService),
      context.get("DBTTerminal"),
      context.get(QueryManifestService),
      context.get(AltimateAuthService),
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
      context.get(AltimateRequest),
      context.get("DBTTerminal"),
      context.get(DbtLineageService),
      context.get(SharedStateService),
      context.get(QueryManifestService),
      context.get(AltimateAuthService),
      context.get(ValidationProvider),
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

// Bind DocumentFormattingEditProviders
container
  .bind(DocumentFormattingEditProviders)
  .toDynamicValue((context) => {
    return new DocumentFormattingEditProviders(
      context.get(DbtDocumentFormattingEditProvider),
      context.get(SqlFmtAvailabilityNotifier),
    );
  })
  .inSingletonScope();

// Bind StatusBars
container
  .bind(StatusBars)
  .toDynamicValue((context) => {
    return new StatusBars(
      context.get(VersionStatusBar),
      context.get(DeferToProductionStatusBar),
      context.get(TargetStatusBar),
    );
  })
  .inSingletonScope();

container
  .bind(OnboardingPanel)
  .toDynamicValue((context) => {
    return new OnboardingPanel(
      context.get(DBTProjectContainer),
      context.get(AltimateRequest),
      context.get(SharedStateService),
      context.get("DBTTerminal"),
      context.get(QueryManifestService),
      context.get(WalkthroughCommands),
      context.get(AltimateAuthService),
    );
  })
  .inSingletonScope();

container
  .bind(WhatsNewPanel)
  .toDynamicValue((context) => {
    return new WhatsNewPanel(
      context.get(DBTProjectContainer),
      context.get(AltimateRequest),
      context.get(SharedStateService),
      context.get("DBTTerminal"),
      context.get(QueryManifestService),
      context.get(AltimateAuthService),
    );
  })
  .inSingletonScope();

// Bind DbtPowerUserActionsCenter
container
  .bind(DbtPowerUserActionsCenter)
  .toDynamicValue((context) => {
    return new DbtPowerUserActionsCenter(
      context.get(DbtPowerUserControlCenterAction),
      context.get(ProjectQuickPick),
      context.get(DBTProjectContainer),
      context.get(SharedStateService),
      context.get(OnboardingPanel),
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
      context.get(AutocompletionProviders),
      context.get(DefinitionProviders),
      context.get(VSCodeCommands),
      context.get(TreeviewProviders),
      context.get(ContentProviders),
      context.get(CodeLensProviders),
      context.get(DocumentFormattingEditProviders),
      context.get(StatusBars),
      context.get(DbtPowerUserActionsCenter),
      context.get("DBTTerminal"),
      context.get(HoverProviders),
      context.get(ValidationProvider),
      context.get(AltimateRequest),
      context.get(AltimateAuthService),
      context.get(WhatsNewPanel),
    );
  })
  .inSingletonScope();
