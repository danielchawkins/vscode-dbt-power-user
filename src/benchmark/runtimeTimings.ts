import { commands, Disposable } from "vscode";
import { readHarnessSwitch } from "../settings";

export const RUNTIME_TIMINGS_COMMAND = "fusionPowerUser.test.getRuntimeTimings";

interface WebviewRuntimeTiming {
  entry: string;
  resolveStart: number;
  ready: number;
  duration: number;
}

const resolveStarts = new Map<string, number>();
const records: WebviewRuntimeTiming[] = [];

function enabled(): boolean {
  return readHarnessSwitch("runtimeBenchmark") === "1";
}

export function beginWebviewResolve(entry: string): void {
  if (enabled()) {
    resolveStarts.set(entry, performance.now());
  }
}

export function completeWebviewReady(entry: string): void {
  if (!enabled()) {
    return;
  }
  const resolveStart = resolveStarts.get(entry);
  if (resolveStart === undefined) {
    return;
  }
  const ready = performance.now();
  records.push({
    entry,
    resolveStart,
    ready,
    duration: ready - resolveStart,
  });
  resolveStarts.delete(entry);
}

export function getWebviewRuntimeTimings(): WebviewRuntimeTiming[] {
  return records.map((record) => ({ ...record }));
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
