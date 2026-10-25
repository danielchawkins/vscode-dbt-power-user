import { ProgressLocation, window } from "vscode";

/**
 * Shows a progress notification while `work` runs. When `cancellable`, the user's cancel aborts the signal `work`
 * receives.
 */
export function withProgress<T>(
  title: string,
  work: (signal: AbortSignal) => Promise<T>,
  cancellable = false,
) {
  return window.withProgress(
    { title, location: ProgressLocation.Notification, cancellable },
    (_progress, token) => {
      const controller = new AbortController();
      if (!cancellable) {
        return work(controller.signal);
      }
      if (token.isCancellationRequested) {
        controller.abort();
      }
      const listener = token.onCancellationRequested(() => controller.abort());
      return work(controller.signal).finally(() => listener.dispose());
    },
  );
}
