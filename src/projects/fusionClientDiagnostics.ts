import { commands, type DiagnosticCollection, Disposable } from "vscode";
import { FusionClientState } from "../fusion/fusionLanguageClient";
import { testCommandsEnabled } from "../settings";
import { FusionClientPool } from "./fusionClientPool";
import { DeclaredProjectOrigin, ProjectRegistry } from "./projectRegistry";

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
  origin: DeclaredProjectOrigin;
  /** The file paths of the documents the current client has opened and not closed. */
  openDocuments: string[];
  /** Compiles the current client has completed; the smoke suite waits for one per client. */
  compiles: number;
  /** Diagnostic counts the current client holds, keyed by file path. */
  diagnosticCounts: Record<string, number>;
}

/** Diagnostic counts of a collection, keyed by file path. */
function countsByFile(
  collection: DiagnosticCollection | undefined,
): Record<string, number> {
  const counts: Record<string, number> = {};
  collection?.forEach((uri, diagnostics) => {
    counts[uri.fsPath] = diagnostics.length;
  });
  return counts;
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
        origin: project.origin,
        openDocuments: client?.openDocuments?.map((uri) => uri.fsPath) ?? [],
        compiles: client?.compiled?.completions ?? 0,
        diagnosticCounts: countsByFile(client?.diagnostics),
      };
    }),
  );
}
