import { existsSync } from "fs";
import { dirname, isAbsolute, join, relative, resolve } from "path";
import which from "which";
import { runProcessText } from "./process";

/** Whether `path` is `dir` or lies anywhere beneath it, such as in `conf.d`. */
function isInside(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** `value` as one shell word, quoted only when it needs to be. */
function quoteArg(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Where mise keeps global and system config, which apply in every directory and so do not make `root` a mise
 * project: the global and system directories (with `conf.d`), `MISE_GLOBAL_CONFIG_FILE`, and the config files mise
 * reads from the home directory itself.
 */
function globalConfigLocations(host: Readonly<Record<string, string>>): {
  dirs: string[];
  files: string[];
} {
  const home = host.HOME ?? host.USERPROFILE ?? "";
  const configHome = host.XDG_CONFIG_HOME || join(home, ".config");
  const dirs = [
    host.MISE_CONFIG_DIR || join(configHome, "mise"),
    host.MISE_SYSTEM_CONFIG_DIR || "/etc/mise",
  ];
  const files = [
    host.MISE_GLOBAL_CONFIG_FILE,
    host.MISE_SYSTEM_CONFIG_FILE,
    ...[
      "mise.toml",
      ".mise.toml",
      "mise.local.toml",
      ".mise.local.toml",
      ".tool-versions",
    ].map((f) => join(home, f)),
    join(home, ".config", "mise.toml"),
    join(home, ".mise", "config.toml"),
  ].filter((file): file is string => Boolean(file));
  return { dirs, files };
}

type ToolManager = "mise" | "direnv";

export type ToolEnvironment =
  | { kind: "none" }
  | {
      kind: "resolved";
      manager: ToolManager;
      /** Variables to set; `null` deletes the variable. */
      overlay: Record<string, string | null>;
    }
  | { kind: "untrusted"; manager: ToolManager; hint: string; detail: string }
  | { kind: "failed"; manager: ToolManager; detail: string };

export interface ToolEnvironmentDeps {
  /** The absolute path of `name` found on `path`, or undefined. */
  which(name: string, path: string | undefined): Promise<string | undefined>;
  run(
    command: string,
    args: readonly string[],
    options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
  ): Promise<{ stdout: string; stderr: string }>;
  /** Whether a file exists; used to find `.envrc`. */
  fileExists(path: string): boolean;
}

const TIMEOUT_MS = 5000;

const defaultDeps: ToolEnvironmentDeps = {
  which: async (name, path) => {
    try {
      return await which(name, { path });
    } catch {
      return undefined;
    }
  },
  run: runProcessText,
  fileExists: existsSync,
};

/** Applies an overlay to the host environment; a `null` value deletes the variable. */
export function applyOverlay(
  host: Readonly<Record<string, string>>,
  overlay: Readonly<Record<string, string | null>>,
): Record<string, string> {
  const result: Record<string, string> = { ...host };
  for (const [key, value] of Object.entries(overlay)) {
    if (value === null) {
      delete result[key];
    } else {
      result[key] = value;
    }
  }
  return result;
}

type Run = (
  command: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>;

/**
 * Reads the environment mise or, failing that, direnv defines for `root`. Read-only: nothing here trusts, installs
 * or answers a prompt.
 */
export async function resolveToolEnvironment(
  root: string,
  host: Readonly<Record<string, string>>,
  deps: ToolEnvironmentDeps = defaultDeps,
): Promise<ToolEnvironment> {
  const run: Run = (command, args) =>
    deps.run(command, args, { cwd: root, env: host, timeoutMs: TIMEOUT_MS });

  let miseOutput: ToolEnvironment | undefined;
  if (await deps.which("mise", host.PATH)) {
    const mise = await probeMise(root, run);
    if (mise.kind !== "resolved") {
      return mise;
    }
    if (await hasProjectConfig(root, host, run)) {
      return mise;
    }
    miseOutput = mise;
  }
  if ((await deps.which("direnv", host.PATH)) && hasEnvrc(root, deps)) {
    return probeDirenv(run);
  }
  return miseOutput ?? { kind: "none" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const code = field(error, "code");
  const firstLine = error.message.split("\n", 1)[0] ?? "";
  return typeof code === "string" || typeof code === "number"
    ? `${firstLine} (${code})`
    : firstLine;
}

function parseVariables(
  text: string,
  allowNull: boolean,
): Record<string, string | null> {
  const parsed = (text.trim() === "" ? {} : JSON.parse(text)) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("expected a JSON object of variables");
  }
  const result: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string" || (allowNull && value === null)) {
      result[key] = value;
    }
  }
  return result;
}

async function probeMise(root: string, run: Run): Promise<ToolEnvironment> {
  try {
    const { stdout } = await run("mise", ["env", "--json", "-C", root]);
    return {
      kind: "resolved",
      manager: "mise",
      overlay: parseVariables(stdout, false),
    };
  } catch (error) {
    const code = field(error, "code");
    const stdout = field(error, "stdout");
    const stderr = field(error, "stderr");
    const text = typeof stderr === "string" ? stderr : "";
    if (
      code === 1 &&
      (typeof stdout !== "string" || !stdout.trim()) &&
      /not trusted/i.test(text)
    ) {
      const file = /Config files in (.+?) (?:are|is) not trusted/i.exec(
        text,
      )?.[1];
      return {
        kind: "untrusted",
        manager: "mise",
        hint: file ? `mise trust ${quoteArg(file)}` : "mise trust",
        detail: text.trim(),
      };
    }
    return { kind: "failed", manager: "mise", detail: describeFailure(error) };
  }
}

/** Whether `mise config ls` lists a file other than the global or system one. A failure counts as no config. */
async function hasProjectConfig(
  root: string,
  host: Readonly<Record<string, string>>,
  run: Run,
): Promise<boolean> {
  try {
    const { stdout } = await run("mise", [
      "config",
      "ls",
      "--json",
      "-C",
      root,
    ]);
    const parsed = JSON.parse(stdout) as unknown;
    if (!Array.isArray(parsed)) {
      return false;
    }
    const entries: unknown[] = parsed;
    const { dirs, files } = globalConfigLocations(host);
    return entries.some((entry: unknown) => {
      const path = field(entry, "path");
      if (typeof path !== "string") {
        return false;
      }
      return !(files.includes(path) || dirs.some((dir) => isInside(dir, path)));
    });
  } catch {
    return false;
  }
}

function hasEnvrc(root: string, deps: ToolEnvironmentDeps): boolean {
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    if (deps.fileExists(join(dir, ".envrc"))) {
      return true;
    }
    if (dirname(dir) === dir) {
      return false;
    }
  }
}

async function probeDirenv(run: Run): Promise<ToolEnvironment> {
  try {
    const status = JSON.parse(
      (await run("direnv", ["status", "--json"])).stdout,
    ) as {
      state?: { foundRC?: { allowed?: unknown } | null };
    };
    const found = status.state?.foundRC;
    if (!found) {
      return { kind: "none" };
    }
    // direnv's `allowed`: 0 allowed, 1 not allowed, 2 denied.
    if (found.allowed !== 0) {
      return {
        kind: "untrusted",
        manager: "direnv",
        hint: "direnv allow",
        detail: ".envrc is not allowed",
      };
    }
    const { stdout } = await run("direnv", ["export", "json"]);
    return {
      kind: "resolved",
      manager: "direnv",
      overlay: parseVariables(stdout, true),
    };
  } catch (error) {
    return {
      kind: "failed",
      manager: "direnv",
      detail: describeFailure(error),
    };
  }
}
