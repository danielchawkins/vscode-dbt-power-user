import { commands, ExtensionContext } from "vscode";
import { ProjectRegistry } from "../projects/projectRegistry";
import { FusionClientPool } from "./fusionClientPool";
import { FusionClientState } from "./fusionLanguageClient";

/** Test-only: reports LSP client state per Declared Project for the VSIX smoke suite. */
export const FUSION_CLIENT_STATES_COMMAND =
  "fusionPowerUser.test.getFusionClientStates";

export interface FusionClientStateReport {
  projectName: string;
  state: FusionClientState;
  failureReason: string | undefined;
}

function enabled(): boolean {
  return (
    process.env.FPU_SMOKE_HOST === "vscode" ||
    process.env.FPU_SMOKE_HOST === "cursor"
  );
}

export function registerFusionClientDiagnostics(
  context: ExtensionContext,
  registry: ProjectRegistry,
  pool: FusionClientPool,
): void {
  if (!enabled()) {
    return;
  }
  context.subscriptions.push(
    commands.registerCommand(FUSION_CLIENT_STATES_COMMAND, () =>
      registry.projects.map((project): FusionClientStateReport => {
        const client = pool.get(project);
        return {
          projectName: project.name,
          state: client?.state ?? "stopped",
          failureReason: client?.failureReason,
        };
      }),
    ),
  );
}
