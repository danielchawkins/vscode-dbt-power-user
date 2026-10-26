import { sleep } from "../async";
import type { WebviewPaintMetric } from "./cdpEvaluation";
import { goneReason, isPainted, isWebviewPaintMetric } from "./cdpEvaluation";
import type { CdpTarget } from "./cdpTransport";
import {
  evaluateContexts,
  listTargets,
  logEntries,
  sendCommand,
} from "./cdpTransport";
import { recordProbe } from "./probeLog";
import { revealWorkbench } from "./workbench";

/** How long each paint check waits for the workbench to become visible before checking the frames anyway. */
const REVEAL_BUDGET_MS = 2_000;

export async function waitForWebviewPaint(
  port: string,
  host: string,
  entry: string,
  timeoutMs = 60_000,
): Promise<WebviewPaintMetric> {
  const deadline = Date.now() + timeoutMs;
  let lastValue: WebviewPaintMetric | undefined;
  let lastTargets: CdpTarget[] = [];
  let visible = false;
  for (;;) {
    visible = await revealWorkbench(
      port,
      host,
      Math.min(REVEAL_BUDGET_MS, Math.max(0, deadline - Date.now())),
    );
    try {
      lastTargets = await listTargets(port);
      const frames = lastTargets.filter(
        (target) => target.type === "iframe" && target.webSocketDebuggerUrl,
      );
      for (const frame of frames) {
        let values: unknown[];
        try {
          values = await evaluateContexts(
            frame.webSocketDebuggerUrl!,
            `(async () => {
              await document.fonts.load("12px codicon");
              return {
                entry: document.body.dataset.entry,
                timeOrigin: performance.timeOrigin,
                firstContentfulPaint: performance.getEntriesByName("first-contentful-paint")[0]?.startTime,
                bodyText: document.body?.innerText.trim().slice(0, 100),
                stylesheets: [...document.styleSheets].map(({ href }) => href).filter(Boolean),
                codiconFont: document.fonts.check("12px codicon")
              };
            })()`,
          );
        } catch {
          continue;
        }
        const value = values.find(
          (candidate): candidate is WebviewPaintMetric =>
            isWebviewPaintMetric(candidate) && candidate.entry === entry,
        );
        lastValue = value ?? lastValue;
        if (value && isPainted(entry, value)) {
          return value;
        }
      }
    } catch {
      // The CDP endpoint can be briefly unavailable while a view is attaching.
    }
    if (Date.now() >= deadline) {
      break;
    }
    await sleep(100);
  }
  throw new Error(
    `Webview did not render with required assets: ${entry} ${JSON.stringify({
      workbenchVisible: visible,
      lastValue,
      targets: lastTargets.map(({ type, title, url }) => ({
        type,
        title,
        url,
      })),
    })}`,
  );
}

/**
 * Evaluates `expression` in every webview frame and returns the first value whose `entry` is `entry`, so the
 * expression must return `{ entry: document.body.dataset.entry, ... }` or a value without it.
 */
export async function evaluatePanel<T extends { entry: string }>(
  port: string,
  entry: string,
  expression: string,
): Promise<{ value: T; target: string } | undefined> {
  return (await scanPanels<T>(port, entry, expression)).match;
}

/** What one pass over the webview frames saw: the match, how many frames it read and the errors it skipped. */
interface PanelScan<T> {
  match?: { value: T; target: string };
  frames: number;
  skipped: string[];
}

async function scanPanels<T extends { entry: string }>(
  port: string,
  entry: string,
  expression: string,
): Promise<PanelScan<T>> {
  const frames = await panelFrames(port);
  const skipped: string[] = [];
  for (const frame of frames) {
    let values: unknown[];
    try {
      values = await evaluateContexts(frame, expression);
    } catch (error) {
      // A frame torn down mid-call is expected during a hide; keep the reason so a false "gone" is visible.
      skipped.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    const value = values.find(
      (candidate): candidate is T =>
        typeof candidate === "object" &&
        candidate !== null &&
        (candidate as { entry?: unknown }).entry === entry,
    );
    if (value) {
      return {
        match: { value, target: frame },
        frames: frames.length,
        skipped,
      };
    }
  }
  return { frames: frames.length, skipped };
}

/**
 * Waits until no webview frame shows `entry`: the view was hidden and, without `retainContextWhenHidden`, its page
 * was torn down. Resolves the milliseconds that took and why it decided the page was gone; rejects at `timeoutMs`.
 */
export async function waitForPanelGone(
  port: string,
  entry: string,
  timeoutMs = 15_000,
): Promise<{
  ms: number;
  reason: ReturnType<typeof goneReason>;
  frames: number;
  skipped: string[];
}> {
  const started = Date.now();
  const probe = `({ entry: document.body.dataset.entry, timeOrigin: performance.timeOrigin })`;
  for (let attempt = 0; ; attempt += 1) {
    const scan = await scanPanels<{ entry: string }>(port, entry, probe);
    recordProbe({
      at: Date.now(),
      label: `${entry} gone`,
      attempt,
      value: scan.match?.value,
      frames: scan.frames,
      skipped: scan.skipped,
      outcome: scan.match ? "polling" : "matched",
    });
    if (!scan.match) {
      return {
        ms: Date.now() - started,
        reason: goneReason(scan),
        frames: scan.frames,
        skipped: scan.skipped,
      };
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(
        `the ${entry} webview was still showing ${timeoutMs}ms after another panel was shown`,
      );
    }
    await sleep(100);
  }
}

/**
 * Messages the frame at `entry` logged about its Content Security Policy, including a blocked WebAssembly
 * compile, which reaches the console as a `CompileError` naming `'unsafe-eval'`.
 */
export async function readCspViolations(
  port: string,
  entry: string,
): Promise<string[]> {
  const panel = await evaluatePanel(
    port,
    entry,
    "({ entry: document.body.dataset.entry })",
  );
  if (!panel) {
    throw new Error(`No webview frame shows ${entry}`);
  }
  const entries = await logEntries(panel.target);
  return entries.filter((text) =>
    /Content Security Policy|unsafe-eval/i.test(text),
  );
}

async function panelFrames(port: string): Promise<string[]> {
  return (await listTargets(port))
    .filter((target) => target.type === "iframe" && target.webSocketDebuggerUrl)
    .map((target) => target.webSocketDebuggerUrl!);
}

/** JavaScript heap of the frame showing `entry`, after a forced garbage collection, from `Runtime.getHeapUsage`. */
export async function readWebviewHeap(
  port: string,
  entry: string,
): Promise<{ usedSize: number; totalSize: number }> {
  const panel = await evaluatePanel(
    port,
    entry,
    "({ entry: document.body.dataset.entry })",
  );
  if (!panel) {
    throw new Error(`No webview frame shows ${entry}`);
  }
  await sendCommand(panel.target, "HeapProfiler.collectGarbage", {}, 10_000);
  const usage = await sendCommand(panel.target, "Runtime.getHeapUsage");
  return {
    usedSize: Number(usage.usedSize),
    totalSize: Number(usage.totalSize),
  };
}
