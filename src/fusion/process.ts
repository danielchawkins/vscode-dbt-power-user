import {
  execFile,
  spawn,
  type ChildProcess,
  type ExecFileOptions,
  type SpawnOptions,
} from "child_process";
import { promisify } from "util";

export type { ChildProcess };

const execFileAsync = promisify(execFile);

export type SpawnProcessOptions = Pick<
  SpawnOptions,
  "cwd" | "env" | "stdio" | "windowsHide"
>;

export type ExecFileTextOptions = Pick<ExecFileOptions, "env" | "maxBuffer">;

/** Spawns `command` directly, never through a shell. */
export function spawnProcess(
  command: string,
  args: readonly string[],
  options: SpawnProcessOptions,
): ChildProcess {
  return spawn(command, args, { ...options, shell: false });
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
    const timer = setTimeout(() => fail("ETIMEDOUT"), options.timeoutMs);
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
