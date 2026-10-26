import type { CancellationToken, Disposable } from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";

/** Fusion's notifications that end a compile; `errors` lists what it found. */
const FUSION_COMPILE_COMPLETE = [
  "dbt/lspCompileComplete",
  "dbt/lspBackgroundCompileComplete",
] as const;

/** The `Error`-severity messages of a compile-complete notification's `errors`. */
function compileErrorMessages(params: unknown): string[] {
  const errors = (params as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(errors)) {
    return [];
  }
  return errors.flatMap((error: { message?: unknown; severity?: unknown }) =>
    error?.severity === "Error" && typeof error.message === "string"
      ? [error.message]
      : [],
  );
}

/** How long a formatting request waits for the server's first compile before giving up. */
const FORMAT_COMPILE_WAIT_MS = 5_000;

/** LSP `RequestFailed`. */
const REQUEST_FAILED = -32803;

/** Counts `dbt/lspCompileComplete` notifications so a request can wait for the next one. */
export class CompileSignal {
  private count = 0;
  private readonly waiters = new Set<() => void>();

  get completions(): number {
    return this.count;
  }

  notify(): void {
    this.count += 1;
    // Snapshot: a waiter removes itself when it runs.
    const waiters = [...this.waiters];
    for (const waiter of waiters) {
      waiter();
    }
  }

  /** Resolves once a compile completes after `since`, after `timeoutMs`, or when `token` is cancelled. */
  async after(
    since: number,
    timeoutMs: number,
    token?: { onCancellationRequested: (listener: () => void) => Disposable },
  ): Promise<void> {
    if (this.count > since) {
      return;
    }
    await new Promise<void>((resolve) => {
      const cancelled = token?.onCancellationRequested(() => done());
      const done = () => {
        clearTimeout(timer);
        cancelled?.dispose();
        this.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      this.waiters.add(done);
    });
  }
}

/** Counts `dbt/lspCompileComplete` on `compiled` and passes each compile's errors to `onCompileErrors`. */
export function subscribeToCompileComplete(
  client: { onNotification?: LanguageClient["onNotification"] },
  compiled: CompileSignal,
  onCompileErrors?: (messages: string[]) => void,
): void {
  for (const method of FUSION_COMPILE_COMPLETE) {
    client.onNotification?.(method, (params: unknown) => {
      if (method === "dbt/lspCompileComplete") {
        compiled.notify();
      }
      onCompileErrors?.(compileErrorMessages(params));
    });
  }
}

/** True for Fusion's refusal to format a document it has not compiled yet. */
function isNoCompilerStateError(error: unknown): boolean {
  const { code, message } = (error ?? {}) as {
    code?: unknown;
    message?: unknown;
  };
  return (
    code === REQUEST_FAILED &&
    typeof message === "string" &&
    message.includes("no compiler state")
  );
}

export const FORMAT_METHODS = new Set([
  "textDocument/formatting",
  "textDocument/rangeFormatting",
]);

/**
 * Runs a formatting request; on the no-compiler-state error waits once for the next compile and retries once.
 * Still failing, or cancelled while waiting, it returns no edits. Other errors propagate.
 * Runs in `middleware.sendRequest`, below the library's failure handler, which would show a toast.
 */
export async function formatOnceCompiled<R>(
  request: () => Promise<R>,
  input: {
    compiled: CompileSignal;
    log: (message: string) => void;
    token: CancellationToken | undefined;
    timeoutMs?: number;
  },
): Promise<R> {
  const { compiled, log, token, timeoutMs = FORMAT_COMPILE_WAIT_MS } = input;
  const since = compiled.completions;
  try {
    return await request();
  } catch (error) {
    if (!isNoCompilerStateError(error)) {
      throw error;
    }
  }
  await compiled.after(since, timeoutMs, token);
  if (token?.isCancellationRequested) {
    return null as R;
  }
  try {
    return await request();
  } catch (error) {
    if (!isNoCompilerStateError(error)) {
      throw error;
    }
    log(
      "Formatting skipped: the server has no compiler state for this document yet.",
    );
    return null as R;
  }
}
