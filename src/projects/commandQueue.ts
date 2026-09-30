import { Disposable, EventEmitter, ProgressLocation, window } from "vscode";
import { DBTCommand } from "../dbt_integration";

/** How a queued command is presented while it runs. */
export interface QueuedCommandOptions {
  statusMessage: string;
  focus?: boolean;
  showProgress?: boolean;
}

/** A queued command that rejected. */
export interface QueuedCommandFailure {
  statusMessage: string;
  error: unknown;
}

/** A command's display string without `--project-dir` and `--profiles-dir`. */
export function formatCommandStatus(command: DBTCommand): string {
  return command
    .getCommandAsString()
    .replace(/\s*--project-dir\s+\S+/g, "")
    .replace(/\s*--profiles-dir\s+\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface QueuedCommand extends QueuedCommandOptions {
  command: (signal?: AbortSignal) => Promise<void>;
}

/**
 * Runs commands one at a time in enqueue order. A rejection fires `onFailed` and the queue continues. With
 * `showProgress`, the command runs under a cancellable progress whose cancellation aborts its signal.
 */
export class CommandQueue implements Disposable {
  private readonly pending: QueuedCommand[] = [];
  private running = false;
  private readonly _onFailed = new EventEmitter<QueuedCommandFailure>();
  readonly onFailed = this._onFailed.event;

  enqueue(
    command: (signal?: AbortSignal) => Promise<void>,
    options: QueuedCommandOptions,
  ): void {
    this.pending.push({ command, ...options });
    void this.runNext();
  }

  dispose(): void {
    this._onFailed.dispose();
  }

  private async runNext(): Promise<void> {
    if (this.running || this.pending.length === 0) {
      return;
    }
    this.running = true;
    const { command, statusMessage, focus, showProgress } =
      this.pending.shift()!;
    const execute = async (signal?: AbortSignal) => {
      try {
        await command(signal);
      } catch (error) {
        this._onFailed.fire({ statusMessage, error });
      }
    };

    if (showProgress) {
      await window.withProgress(
        {
          location: focus
            ? ProgressLocation.Notification
            : ProgressLocation.Window,
          cancellable: true,
          title: statusMessage,
        },
        async (_, token) => {
          const abortController = new AbortController();
          token.onCancellationRequested(() => abortController.abort());
          await execute(abortController.signal);
        },
      );
    } else {
      await execute();
    }
    this.running = false;
    void this.runNext();
  }
}
