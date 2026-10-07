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
  /** Configured path first, then PATH lookup. Never invokes a tool manager. */
  resolve(scope: Uri): Promise<FusionExecutable | FusionVersionVerdict>;
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
  /** Resolves an absolute, executable path for the given PATH lookup name. */
  findOnPath?: (name: string) => Promise<string | undefined>;
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

async function defaultFindOnPath(name: string): Promise<string | undefined> {
  try {
    return await which(name);
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
  const minimum = `${MINIMUM_FUSION.major}.${MINIMUM_FUSION.minor}.${MINIMUM_FUSION.patch}`;
  const requirement = `Fusion Power User needs dbt Fusion ${minimum} or later.`;
  if (verdict.kind === "notFound") {
    return verdict.source === "configured"
      ? `fusionPowerUser.dbtPath for ${label} is ${verdict.path}, which is not an executable file. ${requirement}`
      : `No dbt executable on PATH for ${label}; set fusionPowerUser.dbtPath. ${requirement}`;
  }
  if (verdict.kind === "tooOld") {
    return `dbt Fusion ${verdict.version.major}.${verdict.version.minor}.${verdict.version.patch} for ${label} is too old. ${requirement}`;
  }
  if (verdict.kind === "untestedMajor") {
    return `Untested Fusion major version for ${label}`;
  }
  return `The dbt executable for ${label} is not dbt Fusion (dbt --version printed "${firstLine(verdict.kind === "notFusion" ? verdict.raw : "")}"). ${requirement}`;
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
  private readonly findOnPath: (name: string) => Promise<string | undefined>;
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

  async resolve(scope: Uri): Promise<FusionExecutable | FusionVersionVerdict> {
    const executable = resolveExecutable(this.getConfiguredPath(scope), {
      folder: this.getWorkspaceFolder(scope)?.uri.fsPath,
      userHome: this.getUserHome(),
      lookup: readEnvironmentVariable,
    });
    if (executable.source === "path") {
      return this.resolveFromPath();
    }
    if (
      executable.source === "unresolvable" ||
      !(await this.isExecutable(executable.path))
    ) {
      return { kind: "notFound", path: executable.path, source: "configured" };
    }
    return this.probe(executable.path);
  }

  private async resolveFromPath(): Promise<
    FusionExecutable | FusionVersionVerdict
  > {
    const onPath = await this.findOnPath(PATH_LOOKUP_NAME);
    if (!onPath) {
      return {
        kind: "notFound",
        path: PATH_LOOKUP_NAME,
        source: "path",
      };
    }

    return this.probe(onPath);
  }

  private async probe(
    executablePath: string,
  ): Promise<FusionExecutable | FusionVersionVerdict> {
    const absolutePath = path.resolve(executablePath);
    const env = readEnvironment();
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
      return { kind: "notFusion", raw: runError ?? "empty" };
    }

    const verdict = judgeFusionVersion(parseFusionVersion(raw), raw);
    if (verdict.kind !== "ok" && verdict.kind !== "untestedMajor") {
      return verdict;
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
          `against (minimum supported ${MINIMUM_FUSION.major}.${MINIMUM_FUSION.minor}.${MINIMUM_FUSION.patch}). Continuing.`,
      );
      void globalState?.update(key, true);
    } catch {
      // Global state may be unavailable before extension context is set; the warning is best-effort.
    }
  }
}
