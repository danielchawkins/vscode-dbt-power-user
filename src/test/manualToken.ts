import type { CancellationToken } from "vscode";

/**
 * A caller's token that the test cancels by hand. The vscode mock's token never fires its listeners, so a test that
 * needs a cancel to reach a waiting request uses this one.
 */
export function manualToken(): {
  token: CancellationToken;
  cancel: () => void;
} {
  let cancelled = false;
  const listeners: (() => void)[] = [];
  const token = {
    get isCancellationRequested() {
      return cancelled;
    },
    onCancellationRequested: (listener: () => void) => {
      listeners.push(listener);
      return { dispose: () => undefined };
    },
  } as unknown as CancellationToken;
  return {
    token,
    cancel: () => {
      cancelled = true;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}
