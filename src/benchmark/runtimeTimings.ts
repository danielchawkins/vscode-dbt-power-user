import { commands, Disposable } from "vscode";
import { readHarnessSwitch } from "../settings";

export const RUNTIME_TIMINGS_COMMAND = "fusionPowerUser.test.getRuntimeTimings";

export interface WebviewRuntimeTiming {
  viewPath: string;
  resolveStart: number;
  ready: number;
  duration: number;
}

const resolveStarts = new Map<string, number>();
const records: WebviewRuntimeTiming[] = [];

function enabled(): boolean {
  return readHarnessSwitch("runtimeBenchmark") === "1";
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

/** Registers {@link RUNTIME_TIMINGS_COMMAND} when the runtime benchmark asks for it. */
export function registerRuntimeTimings(): Disposable | undefined {
  if (!enabled()) {
    return undefined;
  }
  return commands.registerCommand(RUNTIME_TIMINGS_COMMAND, () =>
    getWebviewRuntimeTimings(),
  );
}
