import { Disposable } from "vscode";
import { schemaOriginLaunchEnv } from "../core/snapshot/schemaOrigin";
import { LineageService } from "../features/lineage/lineageService";
import { DefaultFusionClientFactory } from "../languageClient/defaultFusionClientFactory";
import {
  type FusionLaunchSources,
  createFusionClientPool,
} from "../projects/clients/fusionClientPool";
import { FusionStatus } from "../projects/clients/fusionStatus";
import { readProjectSnapshot } from "../projects/clients/readProjectSnapshot";
import type { ProjectsGraph } from "./projects";

export function composeFusion(graph: ProjectsGraph) {
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
      environments: graph.projectEnvironments,
      settings: graph.projectSettings,
      outputChannel: fusionOutputChannel,
      launchEnv: {
        resolve: (declared) =>
          schemaOriginLaunchEnv(projects.get(declared.root)),
        onDidChange: projects.onDidChangeManifest,
      },
    },
  );
  graph.clients.pool = fusionClientPool;
  const lineageService = new LineageService({
    currentProject,
    currentClient: () => {
      const project = currentProject.current;
      return project ? fusionClientPool.get(project.declared) : undefined;
    },
    currentError: () => currentProject.current?.errors.current,
    currentLsp: () => currentProject.current?.lsp,
    currentStrict: () => {
      const optIns = currentProject.current?.projectOptIns();
      return {
        strict: optIns?.strict ?? false,
        folder: currentProject.folderScope(),
      };
    },
  });
  const fusionStatus = new FusionStatus({
    registry: graph.projectRegistry,
    clientPool: fusionClientPool,
    optIns: (declared) => projects.get(declared.root)?.projectOptIns(),
    onDidChangeOptIns: (listener) =>
      Disposable.from(
        projects.onDidChangeManifest(listener),
        projects.onDidChangeErrors(listener),
      ),
    projectNotes: (declared) => ({
      error: projects.get(declared.root)?.errors.current,
      environment: graph.projectEnvironments.peek(declared)?.projectDirNotice,
    }),
  });
  return {
    fusionClientPool,
    fusionOutputChannel,
    lineageService,
    fusionStatus,
  };
}
