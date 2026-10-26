import type { CancellationToken, Disposable } from "vscode";
import { CancellationTokenSource } from "vscode";

/**
 * The requests of the column trace in flight. A token for a new trace cancels the previous trace's requests, and
 * `cancel` stops the named trace or, when no trace is named, the current one.
 */
export class ColumnTraceRequests implements Disposable {
  private current: { key: string; source: CancellationTokenSource } | undefined;

  /** The token for the requests of `trace`. */
  token(trace: string): CancellationToken {
    if (this.current?.key !== trace) {
      this.cancel();
      this.current = { key: trace, source: new CancellationTokenSource() };
    }
    return this.current.source.token;
  }

  /** Cancels the trace `trace` names, or the current trace when `trace` is omitted. */
  cancel(trace?: string): void {
    if (this.current && (trace === undefined || this.current.key === trace)) {
      this.current.source.cancel();
      this.current.source.dispose();
      this.current = undefined;
    }
  }

  dispose(): void {
    this.cancel();
  }
}
