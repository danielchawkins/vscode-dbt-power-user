import { commands, type DiagnosticCollection, Disposable } from "vscode";
import { FusionClientState } from "../fusion/fusionLanguageClient";
import { testCommandsEnabled } from "../settings";
import { FusionClientPool } from "./fusionClientPool";
import { FusionStatus } from "./fusionStatus";
import { ProjectEnvironment, ProjectEnvironments } from "./projectEnvironments";
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
  /** Where the project's environment came from; undefined until it has resolved. */
  environmentSource: ProjectEnvironment["source"] | undefined;
  /** The absolute path the current client's executable resolved to. */
  executablePath: string | undefined;
  /** The `--project-dir` the current client was launched with. */
  projectDir: string | undefined;
  /** The client item's rendered detail, including the environment note. */
  statusDetail: string | undefined;
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
  environments: ProjectEnvironments,
  status: FusionStatus,
): Disposable | undefined {
  if (!testCommandsEnabled()) {
    return undefined;
  }
  return commands.registerCommand(FUSION_CLIENT_STATES_COMMAND, () =>
    registry.projects.map((project): FusionClientStateReport => {
      const client = pool.get(project);
      const launch = pool.getLaunch(project);
      return {
        projectName: project.name,
        state: client?.state ?? "stopped",
        failureReason: client?.failureReason,
        target: launch?.target,
        origin: project.origin,
        openDocuments: client?.openDocuments?.map((uri) => uri.fsPath) ?? [],
        compiles: client?.compiled?.completions ?? 0,
        diagnosticCounts: countsByFile(client?.diagnostics),
        environmentSource: environments.peek(project)?.source,
        executablePath: launch?.resolvedPath,
        projectDir: launch?.projectDir,
        statusDetail: status.clientDetail(project.root),
      };
    }),
  );
}
