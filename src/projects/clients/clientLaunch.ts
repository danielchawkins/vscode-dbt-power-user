import type { LogOutputChannel } from "vscode";
import { type LspLaunch, toLspLaunch } from "../../core/lsp";
import type { ProjectSnapshot } from "../../core/snapshot";
import { FailedFusionClient } from "../../fusion/failedFusionClient";
import {
  type FusionClient,
  type FusionClientOptions,
  commandPrefixForProject,
} from "../../fusion/fusionClient";
import {
  type FusionExecutable,
  formatFusionExecutableResolutionFailure,
  isFusionExecutable,
} from "../../fusion/fusionExecutable";
import type { FusionVersionVerdict } from "../../fusion/fusionVersion";
import type {
  DeclaredProject,
  ProjectRegistry,
} from "../registry/projectRegistry";
import type { FusionClientFactory } from "./fusionClientFactory";

/** What {@link launchClient} reads from the pool. */
export interface ClientLaunchSources {
  registry: ProjectRegistry;
  factory: FusionClientFactory;
  outputChannel: (project: DeclaredProject) => LogOutputChannel;
}

/** The per-client inputs {@link launchClient} builds from. */
export interface ClientLaunchInput {
  project: DeclaredProject;
  verdict: FusionExecutable | FusionVersionVerdict;
  snapshot: ProjectSnapshot;
  env: Record<string, string>;
}

/** Builds the launch spec and the client for one project; a failed client when no executable resolved. */
export function launchClient(
  sources: ClientLaunchSources,
  input: ClientLaunchInput,
): { client: FusionClient; launch: LspLaunch } {
  const { project, verdict, snapshot, env } = input;
  const launch = toLspLaunch(
    snapshot,
    isFusionExecutable(verdict) ? verdict.path : undefined,
  );
  const client = isFusionExecutable(verdict)
    ? sources.factory.create({
        project,
        executable: verdict,
        launch,
        commandPrefix: commandPrefixForProject(project),
        env,
        outputChannel: sources.outputChannel(project),
        targetPath: snapshot.paths.targetPath,
        nestedRoots: {
          roots: () => sources.registry.projects.map((other) => other.root),
          onDidChange: sources.registry.onDidChangeProjects,
        },
      } satisfies FusionClientOptions)
    : new FailedFusionClient({
        project,
        message: formatFusionExecutableResolutionFailure(project.name, verdict),
        staticAnalysis: launch.staticAnalysis,
        outputChannel: sources.outputChannel(project),
      });
  return { client, launch };
}
