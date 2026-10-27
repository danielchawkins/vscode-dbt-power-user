import type { CancellationToken, Disposable, Event } from "vscode";
import { EventEmitter } from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";

/** Fusion's notifications that start or end a compile. */
const FUSION_COMPILE_NOTIFICATIONS = [
  "dbt/lspCompileStart",
  "dbt/lspCompileComplete",
  "dbt/lspBackgroundCompileStart",
  "dbt/lspBackgroundCompileComplete",
] as const;

export type CompilePhase = "idle" | "compiling" | "backgroundCompiling";

/** One finished compile; `errors` lists its `Error`-severity messages. */
export interface CompileComplete {
  kind: "foreground" | "background";
  errors: string[];
  modelsCount?: number | undefined;
}

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

/** LSP `RequestFailed`. */
const REQUEST_FAILED = -32803;

/**
 * What one language server is doing with its compiles: the phase it is in now, and how many compiles have finished.
 * Fed by the four `dbt/*` compile notifications through {@link subscribeToCompileState}.
 */
export class ServerCompileState implements Disposable {
  private currentPhase: CompilePhase = "idle";
  private count = 0;
  private readonly completed = new EventEmitter<CompileComplete>();
  private readonly phaseChanged = new EventEmitter<CompilePhase>();

  /** Fires for each finished compile, foreground or background. */
  readonly onDidComplete: Event<CompileComplete> = this.completed.event;
  readonly onDidChangePhase: Event<CompilePhase> = this.phaseChanged.event;

  get phase(): CompilePhase {
    return this.currentPhase;
  }

  get completions(): number {
    return this.count;
  }

  /** Records a compile start; `phase` is the kind of compile that started. */
  started(phase: Exclude<CompilePhase, "idle">): void {
    this.setPhase(phase);
  }

  /** Records a finished compile and returns the phase to idle. */
  finished(complete: CompileComplete): void {
    this.count += 1;
    this.setPhase("idle");
    this.completed.fire(complete);
  }

  private setPhase(phase: CompilePhase): void {
    if (this.currentPhase === phase) {
      return;
    }
    this.currentPhase = phase;
    this.phaseChanged.fire(phase);
  }

  dispose(): void {
    this.completed.dispose();
    this.phaseChanged.dispose();
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
      const subscriptions: Disposable[] = [];
      const done = () => {
        clearTimeout(timer);
        for (const subscription of subscriptions) {
          subscription.dispose();
        }
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      subscriptions.push(this.onDidComplete(done));
      const cancelled = token?.onCancellationRequested(done);
      if (cancelled) {
        subscriptions.push(cancelled);
      }
    });
  }
}

/** Feeds `state` from all four compile notifications of `client`. */
export function subscribeToCompileState(
  client: { onNotification?: LanguageClient["onNotification"] },
  state: ServerCompileState,
): void {
  for (const method of FUSION_COMPILE_NOTIFICATIONS) {
    client.onNotification?.(method, (params: unknown) => {
      switch (method) {
        case "dbt/lspCompileStart":
          state.started("compiling");
          return;
        case "dbt/lspBackgroundCompileStart":
          state.started("backgroundCompiling");
          return;
        case "dbt/lspCompileComplete":
        case "dbt/lspBackgroundCompileComplete":
          state.finished({
            kind: method === "dbt/lspCompileComplete" ? "foreground" : "background",
            errors: compileErrorMessages(params),
            modelsCount: (params as { models_count?: number } | null)?.models_count,
          });
      }
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

/** How long a formatting request waits for the server's first compile before giving up. */
const FORMAT_COMPILE_WAIT_MS = 5_000;

/**
 * Runs a formatting request; on the no-compiler-state error waits once for the next compile and retries once.
 * Still failing, or cancelled while waiting, it returns no edits. Other errors propagate.
 * Runs in `middleware.sendRequest`, below the library's failure handler, which would show a toast.
 */
export async function formatOnceCompiled<R>(
  request: () => Promise<R>,
  input: {
    compiled: ServerCompileState;
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
