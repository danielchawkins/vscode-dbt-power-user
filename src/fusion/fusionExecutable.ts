import { access, constants } from "fs/promises";
import { homedir } from "os";
import * as path from "path";
import { Uri, workspace, WorkspaceFolder } from "vscode";
import which from "which";
import { resolveExecutable } from "../core/project";
import {
  readEnvironment,
  readEnvironmentVariable,
  readSetting,
} from "../settings";
import {
  FusionExecutableSource,
  FusionVersion,
  FusionVersionVerdict,
  judgeFusionVersion,
  MINIMUM_FUSION,
  parseFusionVersion,
} from "./fusionVersion";
import { execFileText } from "./process";

export const DBT_PATH_SETTING = "dbtPath";

const PATH_LOOKUP_NAME = "dbt";

export interface FusionExecutable {
  readonly path: string;
  readonly version: FusionVersion;
  readonly env: Record<string, string>;
}

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

/** The subset of `Memento` the resolver needs to remember which majors it has warned about. */
export interface FusionExecutableGlobalState {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): void | Thenable<void>;
}

const WARNED_MAJOR_KEY_PREFIX = "fusionVersion.warnedMajor.";

export type FusionExecutableResolverDependencies = {
  getConfiguredPath?: (scope: Uri) => string | undefined;
  getWorkspaceFolder?: (scope: Uri) => WorkspaceFolder | undefined;
  getUserHome?: () => string;
  /** Resolves an absolute, executable path for the name on `pathValue`, or on the host PATH without it. */
  findOnPath?: (
    name: string,
    pathValue?: string,
  ) => Promise<string | undefined>;
  isExecutable?: (filePath: string) => Promise<boolean>;
  runVersion?: (
    executable: string,
    env: Record<string, string>,
  ) => Promise<{ stdout: string; stderr: string }>;
  /** Terminal-only warning, never a toast, for an untested-but-newer Fusion major. */
  logWarning?: (message: string) => void;
  /** Lazily resolved because `ExtensionContext.globalState` isn't ready at construction. */
  getGlobalState?: () => FusionExecutableGlobalState | undefined;
};

function readOptionalString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function execFileErrorOutput(error: unknown): {
  stdout: string;
  stderr: string;
} {
  if (typeof error !== "object" || error === null) {
    return { stdout: "", stderr: "" };
  }

  return {
    stdout: readOptionalString(
      Object.getOwnPropertyDescriptor(error, "stdout")?.value,
    ),
    stderr: readOptionalString(
      Object.getOwnPropertyDescriptor(error, "stderr")?.value,
    ),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function versionOutput(stdout: string, stderr: string): string {
  return stdout.trim() !== "" ? stdout : stderr;
}

async function defaultIsExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * A mise shim chooses its version from the directory it runs in, so one found here can pass `--version` where
 * the extension host runs and still fail in the project. Only real binaries count.
 */
function withoutShims(pathValue: string | undefined): string | undefined {
  return pathValue
    ?.split(path.delimiter)
    .filter((entry) => path.basename(entry.replace(/[\\/]+$/, "")) !== "shims")
    .join(path.delimiter);
}

async function defaultFindOnPath(
  name: string,
  pathValue?: string,
): Promise<string | undefined> {
  try {
    return await (pathValue === undefined
      ? which(name)
      : which(name, { path: pathValue }));
  } catch {
    return undefined;
  }
}

async function defaultRunVersion(
  executable: string,
  env: Record<string, string>,
): Promise<{ stdout: string; stderr: string }> {
  return execFileText(executable, ["--version"], {
    env,
    maxBuffer: 1024 * 1024,
  });
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

export class ConfiguredFusionExecutableResolver implements FusionExecutableResolver {
  private readonly getConfiguredPath: (scope: Uri) => string | undefined;
  private readonly getWorkspaceFolder: (
    scope: Uri,
  ) => WorkspaceFolder | undefined;
  private readonly getUserHome: () => string;
  private readonly findOnPath: (
    name: string,
    pathValue?: string,
  ) => Promise<string | undefined>;
  private readonly isExecutable: (filePath: string) => Promise<boolean>;
  private readonly runVersion: (
    executable: string,
    env: Record<string, string>,
  ) => Promise<{ stdout: string; stderr: string }>;
  private readonly logWarning: ((message: string) => void) | undefined;
  private readonly getGlobalState:
    (() => FusionExecutableGlobalState | undefined) | undefined;
  private readonly warnedMajorsThisSession = new Set<number>();

  constructor(deps: FusionExecutableResolverDependencies = {}) {
    this.getConfiguredPath =
      deps.getConfiguredPath ??
      ((scope) => readSetting(DBT_PATH_SETTING, scope));
    this.getWorkspaceFolder =
      deps.getWorkspaceFolder ??
      ((scope) => workspace.getWorkspaceFolder(scope));
    this.getUserHome = deps.getUserHome ?? homedir;
    this.findOnPath = deps.findOnPath ?? defaultFindOnPath;
    this.isExecutable = deps.isExecutable ?? defaultIsExecutable;
    this.runVersion = deps.runVersion ?? defaultRunVersion;
    this.logWarning = deps.logWarning;
    this.getGlobalState = deps.getGlobalState;
  }

  async resolve(
    scope: Uri,
    environment?: ResolverEnvironment,
  ): Promise<FusionExecutable | FusionVersionVerdict> {
    const executable = resolveExecutable(this.getConfiguredPath(scope), {
      folder: this.getWorkspaceFolder(scope)?.uri.fsPath,
      userHome: this.getUserHome(),
      lookup: readEnvironmentVariable,
    });
    if (executable.source === "path") {
      return this.resolveFromPath(environment);
    }
    if (
      executable.source === "unresolvable" ||
      !(await this.isExecutable(executable.path))
    ) {
      return { kind: "notFound", path: executable.path, source: "configured" };
    }
    return this.probe(executable.path, "configured", environment);
  }

  private async resolveFromPath(
    environment: ResolverEnvironment | undefined,
  ): Promise<FusionExecutable | FusionVersionVerdict> {
    const toolSource =
      environment?.source === "host" ? undefined : environment?.source;
    const projectPath =
      environment && toolSource
        ? withoutShims(
            Object.entries(environment.env).find(
              ([key]) => key.toUpperCase() === "PATH",
            )?.[1],
          )
        : undefined;
    const inProject = projectPath
      ? await this.findOnPath(PATH_LOOKUP_NAME, projectPath)
      : undefined;
    const onHost = await this.findOnPath(PATH_LOOKUP_NAME);
    if (inProject && toolSource && inProject !== onHost) {
      return this.probe(inProject, toolSource, environment);
    }
    const onPath = inProject ?? onHost;
    if (!onPath) {
      return {
        kind: "notFound",
        path: PATH_LOOKUP_NAME,
        source: "path",
      };
    }

    return this.probe(onPath, "path", environment);
  }

  private async probe(
    executablePath: string,
    source: FusionExecutableSource,
    environment: ResolverEnvironment | undefined,
  ): Promise<FusionExecutable | FusionVersionVerdict> {
    const absolutePath = path.resolve(executablePath);
    const env = environment ? { ...environment.env } : readEnvironment();
    let stdout = "";
    let stderr = "";
    let runError: string | undefined;

    try {
      const result = await this.runVersion(absolutePath, env);
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      const captured = execFileErrorOutput(error);
      stdout = captured.stdout;
      stderr = captured.stderr;
      runError = errorMessage(error);
    }

    const raw = versionOutput(stdout, stderr);
    if (raw.trim() === "") {
      return {
        kind: "notFusion",
        raw: runError ?? "empty",
        path: absolutePath,
        source,
      };
    }

    const verdict = judgeFusionVersion(parseFusionVersion(raw), raw);
    if (verdict.kind === "tooOld" || verdict.kind === "notFusion") {
      return { ...verdict, path: absolutePath, source };
    }
    if (verdict.kind === "untestedMajor") {
      this.warnUntestedMajorOnce(verdict.version.major);
    }

    return {
      path: absolutePath,
      version: verdict.version,
      env,
    };
  }

  /** Decision: minimum 2.0.6, no upper bound; warn once per major, never a toast. */
  private warnUntestedMajorOnce(major: number): void {
    if (this.warnedMajorsThisSession.has(major)) {
      return;
    }
    this.warnedMajorsThisSession.add(major);

    try {
      const key = `${WARNED_MAJOR_KEY_PREFIX}${major}`;
      const globalState = this.getGlobalState?.();
      if (globalState?.get<boolean>(key)) {
        return;
      }

      this.logWarning?.(
        `dbt Fusion major version ${major} is newer than this extension has been tested ` +
          `against (minimum supported ${MINIMUM_FUSION.major}.${MINIMUM_FUSION.minor}.` +
          `${MINIMUM_FUSION.patch}). Continuing.`,
      );
      void globalState?.update(key, true);
    } catch {
      // Global state may be unavailable before extension context is set; the warning is best-effort.
    }
  }
}
