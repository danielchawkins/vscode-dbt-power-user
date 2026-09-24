import { spawn } from "child_process";

import { EnvironmentVariables } from "./domain";
import { DBTTerminal } from "./terminal";

function isCommandNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function createCommandNotFoundError(command: string): Error {
  return new Error(
    `Command not found: "${command}". ` +
      `The "${command}" executable is not installed or is not on your system PATH. ` +
      `Please ensure it is installed and available. ` +
      `If you installed it in a virtual environment (venv, Poetry, Conda), ` +
      `make sure that environment is activated or its bin directory is in your PATH.`,
  );
}

export class CommandProcessExecutionFactory {
  constructor(private terminal: DBTTerminal) {}

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
}

export class CommandProcessExecution {
  constructor(
    private terminal: DBTTerminal,
    private command: string,
    private args?: string[],
    private stdin?: string,
    private cwd?: string,
    private signal?: AbortSignal,
    private envVars?: EnvironmentVariables,
  ) {}

  private spawn() {
    const proc = spawn(this.command, this.args, {
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

  async complete(): Promise<CommandProcessResult> {
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
      });
      commandProcess.stderr?.on("data", (chunk) => {
        chunk = chunk.toString();
        stderrBuffer += chunk;
        fullOutput += chunk;
      });

      commandProcess.once("close", () => {
        this.terminal.debug(
          "CommandProcessExecution",
          "Return value from command: " + this.command,
          this.args,
          fullOutput,
        );
        resolve({ stdout: stdoutBuffer, stderr: stderrBuffer, fullOutput });
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
          true,
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

  async completeWithTerminalOutput(): Promise<CommandProcessResult> {
    return new Promise((resolve, reject) => {
      const commandProcess = this.spawn();
      let stdoutBuffer = "";
      let stderrBuffer = "";
      let fullOutput = "";
      commandProcess.stdout?.on("data", (chunk) => {
        const line = `${this.formatText(chunk.toString())}`;
        stdoutBuffer += line;
        this.terminal.log(line);
        fullOutput += line;
      });
      commandProcess.stderr?.on("data", (chunk) => {
        const line = `${this.formatText(chunk.toString())}`;
        stderrBuffer += line;
        this.terminal.log(line);
        fullOutput += line;
      });
      commandProcess.once("close", () => {
        resolve({ stdout: stdoutBuffer, stderr: stderrBuffer, fullOutput });
        this.terminal.log("");
      });
      commandProcess.once("error", (error) => {
        if (isCommandNotFoundError(error)) {
          reject(createCommandNotFoundError(this.command));
          return;
        }
        reject(new Error(`Error occurred during process execution: ${error}`));
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

  public formatText(text: string) {
    return `${text.split(/(\r?\n)+/g).join("\r")}`;
  }
}
