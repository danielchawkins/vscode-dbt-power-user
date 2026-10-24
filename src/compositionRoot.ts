import type { ExtensionContext } from "vscode";
import { composeCommands } from "./composition/commands";
import { composeEditorProviders } from "./composition/editorProviders";
import { composeFusion } from "./composition/fusion";
import { composeProjects, type ProjectFactory } from "./composition/projects";
import { composeWebviews } from "./composition/webviews";
import { DBTPowerUserExtension } from "./dbtPowerUserExtension";
import type { ConfiguredFusionExecutableResolver } from "./executable/configuredFusionExecutableResolver";
import type { ExtensionContextStore } from "./extensionContext";
import { ColumnProposalRequests } from "./features/docs/columnProposals";
import { DbtPowerUserActionsCenter } from "./features/projectPicker/actionsCenter";
import { FileAssociationsCommand } from "./features/projectSetup/fileAssociations";
import { ProjectConfigCommands } from "./features/projectSetup/projectConfigCommands";
import { UnservedProjectsNotice } from "./features/projectSetup/unservedProjects";
import { StatusBars } from "./features/statusBars";
import { registerDbtTaskProvider } from "./features/tasks/dbtTaskProvider";
import type { FusionLaunchSources } from "./projects/clients/fusionClientPool";
import type { FusionStatus } from "./projects/clients/fusionStatus";
import { StartupGate } from "./startupGate";

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

/** Constructs the extension's object graph for one activation. */
export function compose(context: ExtensionContext): Composition {
  const graph = composeProjects(context);
  const { terminal, projectRegistry, currentProject } = graph;
  const fusion = composeFusion(graph);
  const startupGate = new StartupGate();
  const columnProposalRequests = new ColumnProposalRequests();
  const commands = composeCommands(graph, startupGate, columnProposalRequests);
  const editor = composeEditorProviders(graph);
  const statusBars = new StatusBars(commands.deferToProductionStatusBar);
  const services = {
    projects: graph.projects,
    statusBars,
    log: terminal,
    projectRegistry,
    fusionClientPool: fusion.fusionClientPool,
    fusionStatus: fusion.fusionStatus,
    startupGate,
    dbtLineageService: fusion.dbtLineageService,
    projectEnvironments: graph.projectEnvironments,
  };
  // Disposed last one first, so shared state and run history outlive everything that reports into them.
  const owned = [
    graph.sharedState,
    graph.runHistoryService,
    terminal,
    graph.projects,
    registerDbtTaskProvider(graph.projects),
    graph.projectEnvironments,
    columnProposalRequests,
    composeWebviews(graph, fusion.dbtLineageService, columnProposalRequests),
    editor.treeviewProviders,
    editor.contentProviders,
    editor.codeLensProviders,
    commands.vscodeCommands,
    statusBars,
    new DbtPowerUserActionsCenter(currentProject, graph.extensionContextStore),
    projectRegistry,
    currentProject,
    fusion.fusionClientPool,
    fusion.fusionStatus,
    new ProjectConfigCommands(startupGate, currentProject, (root) =>
      graph.outputChannels.logFor(root),
    ),
    new FileAssociationsCommand(startupGate, projectRegistry),
    new UnservedProjectsNotice(projectRegistry),
  ];
  return {
    extension: new DBTPowerUserExtension(services, owned),
    extensionContextStore: graph.extensionContextStore,
    fusionStatus: fusion.fusionStatus,
    fusionExecutableResolver: graph.fusionExecutableResolver,
    projectFactory: graph.projectFactory,
    fusionOutputChannel: fusion.fusionOutputChannel,
  };
}
