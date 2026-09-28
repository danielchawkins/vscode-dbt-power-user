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
