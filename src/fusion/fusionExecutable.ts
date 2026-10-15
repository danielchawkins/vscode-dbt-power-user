import type { Uri } from "vscode";
import type {
  FusionExecutableSource,
  FusionVersion,
  FusionVersionVerdict,
} from "./fusionVersion";
import { MINIMUM_FUSION } from "./fusionVersion";

export const DBT_PATH_SETTING = "dbtPath";

export interface FusionExecutable {
  readonly path: string;
  readonly version: FusionVersion;
  readonly env: Record<string, string>;
}

/** Finds the Fusion executable for a project. Implemented outside `fusion/`; see `ExecutableLifecycle`.
 * @port
 */
export interface FusionExecutableResolver {
  /**
   * Configured path first, then `dbt` on the project environment's PATH, then the host PATH.
   * Never invokes a tool manager; `environment` is what one already resolved.
   */
  resolve(
    scope: Uri,
    environment?: ResolverEnvironment,
  ): Promise<FusionExecutable | FusionVersionVerdict>;
}

/** The part of a `ProjectEnvironment` the resolver reads. */
export interface ResolverEnvironment {
  readonly env: Readonly<Record<string, string>>;
  readonly source: "host" | "mise" | "direnv";
}

export function isFusionExecutable(
  verdict: FusionExecutable | FusionVersionVerdict,
): verdict is FusionExecutable {
  return "env" in verdict;
}

export function formatFusionExecutableResolutionFailure(
  label: string,
  verdict: FusionVersionVerdict,
): string {
  const { major, minor, patch } = MINIMUM_FUSION;
  const minimum = `${major}.${minor}.${patch}`;
  const requirement = `Fusion Power User needs dbt Fusion ${minimum} or later.`;
  if (verdict.kind === "notFound") {
    return verdict.source === "configured"
      ? `fusionPowerUser.dbtPath for ${label} is ${verdict.path}, ` +
          `which is not an executable file. ${requirement}`
      : `No dbt executable on PATH for ${label}; ` +
          `set fusionPowerUser.dbtPath. ${requirement}`;
  }
  if (verdict.kind === "tooOld") {
    const { version } = verdict;
    return (
      `dbt Fusion ${version.major}.${version.minor}.${version.patch} at ` +
      `${describeBinary(verdict)} for ${label} is too old. ${requirement}`
    );
  }
  if (verdict.kind === "untestedMajor" || verdict.kind === "ok") {
    throw new Error(
      `Fusion version verdict "${verdict.kind}" is not a resolution failure`,
    );
  }
  return (
    `The dbt executable at ${describeBinary(verdict)} for ${label} is not dbt Fusion ` +
    `(dbt --version printed "${firstLine(verdict.raw)}"). ${requirement}`
  );
}

function describeBinary(binary: {
  path: string;
  source: FusionExecutableSource;
}): string {
  const source =
    binary.source === "configured"
      ? "fusionPowerUser.dbtPath"
      : binary.source === "path"
        ? "PATH"
        : binary.source;
  return `${binary.path} (from ${source})`;
}

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/)[0] ?? "";
}
