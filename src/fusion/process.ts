import {
  execFile,
  spawn,
  type ChildProcess,
  type ExecFileOptions,
  type SpawnOptions,
} from "node:child_process";
import { accessSync, constants as fsConstants, statSync } from "node:fs";
import { constants as osConstants, setPriority } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import type { Log } from "../core/log";

export type { ChildProcess };

/** Niceness of background children: below normal, so interactive work keeps the CPU. */
const BACKGROUND_NICE = "10";

const execFileAsync = promisify(execFile);

export type ProcessPriority = "normal" | "background";

export type SpawnProcessOptions = Pick<
  SpawnOptions,
  "cwd" | "env" | "stdio" | "windowsHide"
> & {
  /** `background` lowers the child's scheduling priority so interactive work keeps the CPU. */
  priority?: ProcessPriority;
  /** Receives a debug line when `background` cannot be applied. */
  log?: Pick<Log, "debug">;
};

/** `timeout` kills the process after that many milliseconds; the call then rejects with `killed` set. */
export type ExecFileTextOptions = Pick<
  ExecFileOptions,
  "env" | "maxBuffer" | "timeout"
>;

/** Spawns `command` directly, never through a shell. `background` lowers the child's scheduling priority. */
export function spawnProcess(
  command: string,
  args: readonly string[],
  options: SpawnProcessOptions,
): ChildProcess {
  const { priority, log, ...spawnOptions } = options;
  const launch = { ...spawnOptions, shell: false };
  if (priority !== "background") {
    return spawn(command, args, launch);
  }
  if (process.platform === "win32") {
    const child = spawn(command, args, launch);
    lowerPriority(child, log);
    return child;
  }
  const nice = findOnPath("nice", spawnOptions.env ?? process.env);
  if (nice === undefined) {
    log?.debug(
      "process",
      `nice is not on PATH; running ${command} at normal priority`,
    );
    return spawn(command, args, launch);
  }
  return spawn(nice, ["-n", BACKGROUND_NICE, command, ...args], launch);
}

function lowerPriority(child: ChildProcess, log?: Pick<Log, "debug">): void {
  if (child.pid === undefined) {
    return;
  }
  try {
    setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL);
  } catch (error) {
    log?.debug("process", `could not lower priority of pid ${child.pid}`, error);
  }
}

function findOnPath(name: string, env: NodeJS.ProcessEnv): string | undefined {
  return (env.PATH ?? "")
    .split(delimiter)
    .filter((dir) => dir !== "")
    .map((dir) => join(dir, name))
    .find(isExecutableFile);
}

function isExecutableFile(file: string): boolean {
  try {
    accessSync(file, fsConstants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

export interface RunProcessTextOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** After this many milliseconds the process is sent SIGTERM and the call rejects with `code: "ETIMEDOUT"`. */
  timeoutMs: number;
  /** Bytes allowed on each of stdout and stderr; Node's `execFile` default of 1 MiB when unset. */
  maxBuffer?: number;
}

const DEFAULT_MAX_BUFFER = 1024 * 1024;

/**
 * Runs `command` without a shell, with stdin ignored, and resolves its UTF-8 output. Rejects the way
 * `execFileText` does: an error carrying `code`, `signal`, `stdout` and `stderr`, where `code` is the exit number or
 * the errno string when the process fails to start. A process that outlives `timeoutMs` is sent SIGTERM and rejects
 * with `code: "ETIMEDOUT"`; one that exceeds `maxBuffer` is sent SIGTERM and rejects with
 * `code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"`.
 */
export function runProcessText(
  command: string,
  args: readonly string[],
  options: RunProcessTextOptions,
): Promise<{ stdout: string; stderr: string }> {
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let failure: string | undefined;
    let settled = false;
    const fail = (code: string) => {
      failure ??= code;
      child.kill("SIGTERM");
    };
    const timer = setTimeout(fail, options.timeoutMs, "ETIMEDOUT");
    const collect = (stream: "out" | "err") => (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (stream === "out") {
        stdout += text;
      } else {
        stderr += text;
      }
      if (Buffer.byteLength(stream === "out" ? stdout : stderr) > maxBuffer) {
        fail("ERR_CHILD_PROCESS_STDIO_MAXBUFFER");
      }
    };
    child.stdout?.on("data", collect("out"));
    child.stderr?.on("data", collect("err"));
    const finish = (code: string | number | null, signal: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (failure === undefined && code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = Object.assign(
        new Error(`Command failed: ${[command, ...args].join(" ")}\n${stderr}`),
        { code: failure ?? code, signal, stdout, stderr },
      );
      reject(error);
    };
    child.on("error", (error: NodeJS.ErrnoException) =>
      finish(error.code ?? null, null),
    );
    child.on("close", finish);
  });
}

/**
 * Runs `command` without a shell and resolves its UTF-8 output. When the process fails to start or exits
 * non-zero, rejects with an error carrying `code`, `signal`, `stdout` and `stderr`. `code` is the errno string
 * (for example `"ENOENT"`) when the process fails to start and the exit number otherwise.
 */
export async function execFileText(
  command: string,
  args: readonly string[],
  options: ExecFileTextOptions,
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(command, args, {
    ...options,
    encoding: "utf8",
    shell: false,
  });
  return { stdout, stderr };
}
