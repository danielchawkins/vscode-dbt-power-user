import { commands, Disposable } from "vscode";
import { ProjectRegistry } from "../projects/projectRegistry";
import { testCommandsEnabled } from "../settings";
import { FusionClientPool } from "./fusionClientPool";
import { FusionClientState } from "./fusionLanguageClient";

/**
 * Test-only: reports LSP client state per Declared Project for the smoke and integration suites.
 * @internal
 */
export const FUSION_CLIENT_STATES_COMMAND =
  "fusionPowerUser.test.getFusionClientStates";

/** @internal */
export interface FusionClientStateReport {
  projectName: string;
  state: FusionClientState;
  failureReason: string | undefined;
  /** The `--target` the current client was launched with. */
  target: string | undefined;
}

/** Registers {@link FUSION_CLIENT_STATES_COMMAND} when a test harness asks for it. */
export function registerFusionClientDiagnostics(
  registry: ProjectRegistry,
  pool: FusionClientPool,
): Disposable | undefined {
  if (!testCommandsEnabled()) {
    return undefined;
  }
  return commands.registerCommand(FUSION_CLIENT_STATES_COMMAND, () =>
    registry.projects.map((project): FusionClientStateReport => {
      const client = pool.get(project);
      return {
        projectName: project.name,
        state: client?.state ?? "stopped",
        failureReason: client?.failureReason,
        target: pool.getLaunch(project)?.target,
      };
    }),
  );
}
