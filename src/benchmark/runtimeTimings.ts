import { commands, ExtensionContext } from "vscode";

export const RUNTIME_TIMINGS_COMMAND = "dbtPowerUser.test.getRuntimeTimings";

export interface WebviewRuntimeTiming {
  viewPath: string;
  resolveStart: number;
  ready: number;
  duration: number;
}

const resolveStarts = new Map<string, number>();
const records: WebviewRuntimeTiming[] = [];

function enabled(): boolean {
  return process.env.FPU_RUNTIME_BENCHMARK === "1";
}

export function beginWebviewResolve(viewPath: string): void {
  if (enabled()) {
    resolveStarts.set(viewPath, performance.now());
  }
}

export function completeWebviewReady(viewPath: string): void {
  if (!enabled()) {
    return;
  }
  const resolveStart = resolveStarts.get(viewPath);
  if (resolveStart === undefined) {
    return;
  }
  const ready = performance.now();
  records.push({
    viewPath,
    resolveStart,
    ready,
    duration: ready - resolveStart,
  });
  resolveStarts.delete(viewPath);
}

export function getWebviewRuntimeTimings(): WebviewRuntimeTiming[] {
  return records.map((record) => ({ ...record }));
}

export function clearWebviewRuntimeTimings(): void {
  resolveStarts.clear();
  records.length = 0;
}

export function registerRuntimeTimings(context: ExtensionContext): void {
  if (!enabled()) {
    return;
  }
  context.subscriptions.push(
    commands.registerCommand(RUNTIME_TIMINGS_COMMAND, () =>
      getWebviewRuntimeTimings(),
    ),
  );
}
