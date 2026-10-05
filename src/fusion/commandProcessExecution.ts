import { spawnProcess } from "./process";

import type { Log } from "../core/log";
import { EnvironmentVariables } from "../dbt_integration/domain";

function isCommandNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function createCommandNotFoundError(command: string): Error {
  return new Error(
    `Command not found: "${command}". ` +
      `Install dbt Fusion, then put it on PATH or set fusionPowerUser.dbtPath.`,
  );
}

export class CommandProcessExecutionFactory {
  constructor(private terminal: Log) {}

  createCommandProcessExecution({
    command,
    args,
    stdin,
    cwd,
    signal,
    envVars,
  }: {
    command: string;
    args?: string[];
    stdin?: string;
    cwd?: string;
    signal?: AbortSignal;
    envVars?: EnvironmentVariables;
  }) {
    return new CommandProcessExecution(
      this.terminal,
      command,
      args,
      stdin,
      cwd,
      signal,
      envVars,
    );
  }
}

export interface CommandProcessResult {
  stdout: string;
  stderr: string;
  fullOutput: string;
  /** Null when the process was ended by a signal. */
  exitCode?: number | null;
}

/** @internal */
export class CommandProcessExecution {
  constructor(
    private terminal: Log,
    private command: string,
    private args?: string[],
    private stdin?: string,
    private cwd?: string,
    private signal?: AbortSignal,
    private envVars?: EnvironmentVariables,
  ) {}

  private spawn() {
    const proc = spawnProcess(this.command, this.args ?? [], {
      cwd: this.cwd,
      env: this.envVars,
      stdio: ["pipe", "pipe", "pipe"],
      // Output is captured over pipes, so the console window Windows would
      // otherwise allocate for each dbt subprocess is pure noise. Without this,
      // spawning the dbt CLI from the (console-less) extension host pops a
      // visible window per command.
      windowsHide: true,
    });

    if (this.signal) {
      const abortHandler = () => {
        proc.kill("SIGTERM");
      };

      if (this.signal.aborted) {
        abortHandler();
      } else {
        this.signal.addEventListener("abort", abortHandler);
      }
    }

    return proc;
  }

  /**
   * Runs the command to exit. `onOutput` receives each stdout and stderr chunk in arrival order; the result is the
   * same with or without it.
   */
  async complete({
    onOutput,
  }: {
    onOutput?: (chunk: string) => void;
  } = {}): Promise<CommandProcessResult> {
    return new Promise<CommandProcessResult>((resolve, reject) => {
      this.terminal.debug(
        "CommandProcessExecution",
        "Going to execute command : " + this.command,
        this.args,
      );
      const commandProcess = this.spawn();
      let stdoutBuffer = "";
      let stderrBuffer = "";
      let fullOutput = "";
      commandProcess.stdout?.on("data", (chunk) => {
        chunk = chunk.toString();
        stdoutBuffer += chunk;
        fullOutput += chunk;
        onOutput?.(chunk);
      });
      commandProcess.stderr?.on("data", (chunk) => {
        chunk = chunk.toString();
        stderrBuffer += chunk;
        fullOutput += chunk;
        onOutput?.(chunk);
      });

      commandProcess.once("close", (exitCode: number | null) => {
        this.terminal.debug(
          "CommandProcessExecution",
          "Return value from command: " + this.command,
          this.args,
          fullOutput,
        );
        resolve({
          stdout: stdoutBuffer,
          stderr: stderrBuffer,
          fullOutput,
          exitCode,
        });
      });

      commandProcess.once("error", (error) => {
        if (isCommandNotFoundError(error)) {
          reject(createCommandNotFoundError(this.command));
          return;
        }
        this.terminal.error(
          "CommandProcessExecutionError",
          "Command errored: " + this.command,
          error,
          this.command,
          this.args,
          error,
        );
        reject(new Error(`${error}`));
      });

      if (this.stdin && commandProcess.stdin) {
        try {
          commandProcess.stdin.write(this.stdin);
          commandProcess.stdin.end();
        } catch (_) {
          // stdin may not be writable if spawn failed (e.g. EBADF)
        }
      }
    });
  }
}
