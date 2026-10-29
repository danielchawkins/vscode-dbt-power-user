import { type ExtensionContext, Disposable } from "vscode";
import type { Log } from "../core/log";
import { createProjectParsers } from "../core/manifest/projectParsers";
import { ConfiguredFusionExecutableResolver } from "../executable/configuredFusionExecutableResolver";
import { ExtensionContextStore } from "../extensionContext";
import { createProjectMetadataSource } from "../metadata/compositeMetadataSource";
import { onClientChange } from "../projects/clients/clientChange";
import type { FusionClientPool } from "../projects/clients/fusionClientPool";
import { ProjectEnvironments } from "../projects/clients/projectEnvironments";
import { MetadataDemand } from "../projects/manifest/metadataDemand";
import { bindExtensionOutput } from "../projects/output/notifications";
import { OutputChannels } from "../projects/output/outputChannels";
import { RunHistoryService } from "../projects/output/runHistoryService";
import { CurrentProject } from "../projects/project/currentProject";
import { Project } from "../projects/project/project";
import { ProjectQuickPick } from "../projects/project/projectQuickPick";
import { Projects } from "../projects/project/projects";
import { QueryManifestService } from "../projects/project/queryManifestService";
import { QueryPanelRequests } from "../projects/project/queryPanelRequests";
import type { DeclaredProject } from "../projects/registry/projectRegistry";
import { ProjectRegistry } from "../projects/registry/projectRegistry";
import { cliFactoryFor } from "./fusionCli";

/** Builds the Project of a Declared Project. */
export type ProjectFactory = (project: DeclaredProject) => Project;

export function composeProjects(context: ExtensionContext) {
  const extensionContextStore = new ExtensionContextStore(context);
  const outputChannels = new OutputChannels(context.extension.id);
  bindExtensionOutput(() => outputChannels.channel.show(true));
  const terminal: Log = outputChannels;
  const queryRequests = new QueryPanelRequests();
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
  const projectEnvironments = new ProjectEnvironments(
    outputChannels.projectLog.bind(outputChannels),
  );
  const metadataDemand = new MetadataDemand();
  const metadataSourceDeps = { demand: metadataDemand, log: terminal };
  const projectFactory: ProjectFactory = (declared) => {
    const log = outputChannels.projectLog(declared);
    return new Project({
      terminal: log,
      queryRequests,
      runHistoryService,
      resolver: fusionExecutableResolver,
      environment: () => projectEnvironments.ensure(declared),
      cliFactory: cliFactoryFor(declared, projectEnvironments, log),
      parsers: createProjectParsers(log),
      declared,
      root: declared.root,
      projectCount: () => projects.all().length,
      fusionClient: () => clients.pool?.get(declared),
      clientChanged: (listener) =>
        clients.pool
          ? onClientChange(clients.pool, declared)(listener)
          : Disposable.from(),
      metadataDemand,
    });
  };

  const projectRegistry = new ProjectRegistry(terminal);
  outputChannels.follow(projectRegistry);
  const projects = new Projects(
    projectRegistry,
    {
      project: projectFactory,
      metadataSource: (declared, project) =>
        createProjectMetadataSource(declared, project, metadataSourceDeps),
    },
    terminal,
  );
  const projectQuickPick = new ProjectQuickPick();
  const currentProject = new CurrentProject(
    projectRegistry,
    projects,
    projectQuickPick,
  );
  const queryManifestService = new QueryManifestService(currentProject);
  return {
    extensionContextStore,
    outputChannels,
    terminal,
    queryRequests,
    runHistoryService,
    fusionExecutableResolver,
    projectEnvironments,
    projectFactory,
    projectRegistry,
    projects,
    projectQuickPick,
    currentProject,
    queryManifestService,
    clients,
    metadataDemand,
  };
}

export type ProjectsGraph = ReturnType<typeof composeProjects>;
