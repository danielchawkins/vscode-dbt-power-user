import { execFile as execFileCb } from "child_process";
import { access, constants } from "fs/promises";
import { homedir } from "os";
import * as path from "path";
import { promisify } from "util";
import { Uri, workspace, WorkspaceFolder } from "vscode";
import which from "which";
import { CONFIGURATION_SECTION } from "../projects/projectConfiguration";
import { resolveSettingsVariables } from "../utils";
import {
  FusionVersion,
  FusionVersionVerdict,
  judgeFusionVersion,
  parseFusionVersion,
} from "./fusionVersion";

const execFile = promisify(execFileCb);

export const FUSION_PATH_SETTING = "fusionPath";

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
};

function inheritedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

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
  const { stdout, stderr } = await execFile(executable, ["--version"], {
    env,
    maxBuffer: 1024 * 1024,
  });
  return { stdout, stderr };
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
  if (verdict.kind === "notFound") {
    return `Fusion executable not found for ${label} at ${verdict.path ?? "unknown path"}`;
  }
  if (verdict.kind === "tooOld") {
    return `Fusion version too old for ${label}`;
  }
  if (verdict.kind === "untestedMajor") {
    return `Untested Fusion major version for ${label}`;
  }
  return `Fusion executable invalid for ${label}`;
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

  constructor(deps: FusionExecutableResolverDependencies = {}) {
    this.getConfiguredPath =
      deps.getConfiguredPath ??
      ((scope) =>
        workspace
          .getConfiguration(CONFIGURATION_SECTION, scope)
          .get<string>(FUSION_PATH_SETTING));
    this.getWorkspaceFolder =
      deps.getWorkspaceFolder ??
      ((scope) => workspace.getWorkspaceFolder(scope));
    this.getUserHome = deps.getUserHome ?? homedir;
    this.findOnPath = deps.findOnPath ?? defaultFindOnPath;
    this.isExecutable = deps.isExecutable ?? defaultIsExecutable;
    this.runVersion = deps.runVersion ?? defaultRunVersion;
  }

  async resolve(scope: Uri): Promise<FusionExecutable | FusionVersionVerdict> {
    const configured = this.getConfiguredPath(scope)?.trim();
    if (configured) {
      return this.resolveConfigured(scope, configured);
    }
    return this.resolveFromPath();
  }

  private async resolveConfigured(
    scope: Uri,
    configured: string,
  ): Promise<FusionExecutable | FusionVersionVerdict> {
    const folder = this.getWorkspaceFolder(scope);
    const substituted = resolveSettingsVariables(
      configured,
      folder?.uri ?? null,
      this.getUserHome(),
    );

    if (substituted.includes("${workspaceFolder}")) {
      return { kind: "notFound", path: substituted, source: "configured" };
    }

    const resolved = path.isAbsolute(substituted)
      ? path.resolve(substituted)
      : folder
        ? path.resolve(folder.uri.fsPath, substituted)
        : substituted;

    if (!path.isAbsolute(resolved)) {
      return { kind: "notFound", path: resolved, source: "configured" };
    }

    if (!(await this.isExecutable(resolved))) {
      return { kind: "notFound", path: resolved, source: "configured" };
    }

    return this.probe(resolved);
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
    const env = inheritedEnv();
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
    if (verdict.kind !== "ok") {
      return verdict;
    }

    return {
      path: absolutePath,
      version: verdict.version,
      env,
    };
  }
}
