import type { ChildProcess } from "./process";
import type { ExitingProcess } from "./reverseSocketTransport";

export const CONNECTION_TIMEOUT_MS = 30_000;
export const BACKOFF_BASE_MS = 500;
export const BACKOFF_CAP_MS = 8_000;
const STDERR_BUFFER_LIMIT = 16_384;
const PARTIAL_LINE_LIMIT = 4_096;

/**
 * Line buffer for piped Fusion server stdout/stderr.
 * @internal
 */
export class ProcessStreamBuffer {
  private partial = "";

  feed(chunk: Buffer | string, onLine: (line: string) => void): void {
    this.partial += chunk.toString();
    const parts = this.partial.split(/\r?\n/);
    this.partial = parts.pop() ?? "";
    for (const line of parts) {
      const trimmed = line.trimEnd();
      if (trimmed) {
        onLine(trimmed);
      }
    }
    if (this.partial.length > PARTIAL_LINE_LIMIT) {
      this.partial = this.partial.slice(0, PARTIAL_LINE_LIMIT);
    }
  }

  flush(onLine: (line: string) => void): void {
    const trimmed = this.partial.trim();
    if (trimmed) {
      onLine(trimmed);
    }
    this.partial = "";
  }
}

class StderrAccumulator {
  private text = "";

  append(line: string): void {
    this.text += `${line}\n`;
    if (this.text.length > STDERR_BUFFER_LIMIT) {
      this.text = this.text.slice(-STDERR_BUFFER_LIMIT);
    }
  }

  get(): string {
    return this.text;
  }
}

/** Child process adapter; stderr-only accumulator feeds getStderr(). */
export class SpawnedLspProcess implements ExitingProcess {
  private readonly stderrAccumulator = new StderrAccumulator();
  private readonly stdoutBuffer = new ProcessStreamBuffer();
  private readonly stderrStreamBuffer = new ProcessStreamBuffer();

  constructor(
    private readonly child: ChildProcess,
    private readonly onChannelLine?: (line: string) => void,
  ) {
    const appendChannelLine = (line: string): void => {
      this.onChannelLine?.(line);
    };
    const appendStderrLine = (line: string): void => {
      this.stderrAccumulator.append(line);
      appendChannelLine(line);
    };
    child.stdout?.on("data", (chunk: Buffer | string) => {
      this.stdoutBuffer.feed(chunk, appendChannelLine);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      this.stderrStreamBuffer.feed(chunk, appendStderrLine);
    });
    child.on("close", () => {
      this.stdoutBuffer.flush(appendChannelLine);
      this.stderrStreamBuffer.flush(appendStderrLine);
    });
  }

  get exitCode(): number | null {
    return this.child.exitCode;
  }

  get signalCode(): NodeJS.Signals | null {
    return this.child.signalCode;
  }

  on(event: "exit", listener: () => void): void {
    this.child.on(event, listener);
  }

  removeListener(event: "exit", listener: () => void): void {
    this.child.removeListener(event, listener);
  }

  getStderr(): string {
    return this.stderrAccumulator.get();
  }

  kill(signal: NodeJS.Signals): void {
    this.child.kill(signal);
  }
}

function waitForProcessExit(
  processAdapter: SpawnedLspProcess,
  timeoutMs?: number,
): Promise<boolean> {
  if (processAdapter.exitCode !== null || processAdapter.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const onExit = (): void => {
      if (timeoutMs !== undefined) {
        clearTimeout(timer);
      }
      processAdapter.removeListener("exit", onExit);
      resolve(true);
    };
    processAdapter.on("exit", onExit);
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            processAdapter.removeListener("exit", onExit);
            resolve(false);
          }, timeoutMs);
  });
}

const hasExited = (processAdapter: SpawnedLspProcess): boolean =>
  processAdapter.exitCode !== null || processAdapter.signalCode !== null;

/** Sends SIGTERM, then SIGKILL after `graceMs`, and resolves once the process is gone or SIGKILL also timed out. */
export async function terminateProcess(
  processAdapter: SpawnedLspProcess,
  options: {
    graceMs: number;
    sleep: (ms: number) => Promise<void>;
    warn: (message: string) => void;
    name: string;
  },
): Promise<void> {
  if (hasExited(processAdapter)) {
    return;
  }
  const exitPromise = waitForProcessExit(processAdapter);
  processAdapter.kill("SIGTERM");
  const exited = await Promise.race([
    exitPromise.then(() => true),
    options.sleep(options.graceMs).then(() => false),
  ]);
  if (exited || hasExited(processAdapter)) {
    return;
  }
  const killExitPromise = waitForProcessExit(processAdapter, options.graceMs);
  processAdapter.kill("SIGKILL");
  if (!(await killExitPromise)) {
    options.warn(
      `Fusion LSP process for ${options.name} did not exit after SIGKILL`,
    );
  }
}
