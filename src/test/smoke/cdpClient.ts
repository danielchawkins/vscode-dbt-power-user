import { commands } from "vscode";
import {
  allDispatchedSlotsSettled,
  assembleEvaluationResults,
  ContextSlot,
  DispatchedContext,
} from "./cdpEvaluation";
import {
  aggregateWorkbenchNotificationSnapshots,
  collectWorkbenchNotifications,
  NOTIFICATION_CENTER_ITEM_SELECTOR,
  NOTIFICATION_TOAST_ITEM_SELECTOR,
  WorkbenchNotificationSnapshot,
} from "./notificationToasts";

export type SmokeHost = "vscode" | "cursor";

const SHOW_NOTIFICATIONS = "notifications.showList";
const HIDE_NOTIFICATIONS = "notifications.hideList";

interface CdpTarget {
  type: string;
  title?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

export function validateSmokeHost(host: string): SmokeHost {
  if (host === "vscode" || host === "cursor") {
    return host;
  }
  throw new Error(`Unsupported smoke host: ${host}`);
}

export interface WebviewPaintMetric {
  entry: string;
  timeOrigin: number;
  firstContentfulPaint: number;
  bodyText: string;
  stylesheets: string[];
  codiconFont: boolean;
}

const WORKBENCH_NOTIFICATION_COLLECTOR = `(${collectWorkbenchNotifications.toString()})(
  document,
  ${JSON.stringify(NOTIFICATION_CENTER_ITEM_SELECTOR)},
  ${JSON.stringify(NOTIFICATION_TOAST_ITEM_SELECTOR)}
)`;

function matchesWorkbenchPage(target: CdpTarget, host: string): boolean {
  if (
    target.type !== "page" ||
    !target.webSocketDebuggerUrl ||
    target.url?.startsWith("devtools://")
  ) {
    return false;
  }
  const url = target.url ?? "";
  if (!url.includes("/workbench/workbench.html")) {
    return false;
  }
  const smokeHost = validateSmokeHost(host);
  if (smokeHost === "vscode") {
    return url.includes("vscode-app");
  }
  return url.includes("cursor") || target.title?.includes("Cursor") === true;
}

function isWorkbenchNotificationSnapshot(
  value: unknown,
): value is WorkbenchNotificationSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<WorkbenchNotificationSnapshot>;
  return (
    typeof candidate.workbench === "boolean" &&
    Array.isArray(candidate.toasts) &&
    candidate.toasts.every((entry) => typeof entry === "string")
  );
}

export async function readWorkbenchNotificationTexts(
  port: string,
  host: string,
  attempts = 20,
): Promise<string[]> {
  const smokeHost = validateSmokeHost(host);
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const target = await findWorkbenchPageTarget(port, smokeHost);
      const values = await evaluateContexts(
        target.webSocketDebuggerUrl!,
        WORKBENCH_NOTIFICATION_COLLECTOR,
      );
      const snapshots = values.map((value) => {
        if (!isWorkbenchNotificationSnapshot(value)) {
          throw new Error(
            `CDP notification collector returned unexpected value: ${JSON.stringify(value)}`,
          );
        }
        return value;
      });
      return aggregateWorkbenchNotificationSnapshots(snapshots).toasts;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await sleep(100);
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? "CDP notification read failed"));
}

/** Fails when the workbench shows any notification, toast or centered. */
export async function assertNoWorkbenchNotifications(
  cdpPort: string,
  smokeHost: string,
): Promise<void> {
  await commands.executeCommand(SHOW_NOTIFICATIONS);
  try {
    const notifications = await readWorkbenchNotificationTexts(
      cdpPort,
      smokeHost,
    );
    if (notifications.length > 0) {
      throw new Error(
        `Unexpected workbench notifications: ${JSON.stringify(notifications)}`,
      );
    }
  } finally {
    await commands.executeCommand(HIDE_NOTIFICATIONS);
  }
}

const VISIBLE_FRAME = `document.visibilityState !== "visible" ? false : Promise.race([
  new Promise((resolve) => requestAnimationFrame(() => resolve(true))),
  new Promise((resolve) => setTimeout(() => resolve(false), 1000)),
])`;

/**
 * Raises the workbench window and waits until its page is visible and producing frames, since a hidden window
 * renders neither editor lines nor webview paints. Returns whether it became visible before `timeoutMs`.
 */
export async function revealWorkbench(
  port: string,
  host: string,
  timeoutMs = 30_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      const target = await findWorkbenchPageTarget(
        port,
        validateSmokeHost(host),
      );
      await sendCommand(target.webSocketDebuggerUrl!, "Page.bringToFront");
      const values = await evaluateContexts(
        target.webSocketDebuggerUrl!,
        VISIBLE_FRAME,
      );
      if (values.includes(true)) {
        return true;
      }
    } catch {
      // A starved renderer can miss the evaluation timeout; retry until the deadline.
    }
    await sleep(250);
  } while (Date.now() < deadline);
  return false;
}

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
        if (
          value &&
          value.bodyText &&
          value.stylesheets.some((href) => href.endsWith(`/${entry}.css`)) &&
          value.stylesheets.some((href) => href.endsWith("/codicon.css")) &&
          value.codiconFont
        ) {
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
  for (const frame of await panelFrames(port)) {
    let values: unknown[];
    try {
      values = await evaluateContexts(frame, expression);
    } catch {
      continue;
    }
    const value = values.find(
      (candidate): candidate is T =>
        typeof candidate === "object" &&
        candidate !== null &&
        (candidate as { entry?: unknown }).entry === entry,
    );
    if (value) {
      return { value, target: frame };
    }
  }
  return undefined;
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

/**
 * Used heap of each dedicated worker the frame showing `entry` started, after a forced garbage collection in each,
 * read through sessions `Target.setAutoAttach` opens on the frame's target.
 */
export async function readWorkerHeaps(
  port: string,
  entry: string,
): Promise<{ url: string; usedSize: number }[]> {
  const panel = await evaluatePanel(
    port,
    entry,
    "({ entry: document.body.dataset.entry })",
  );
  if (!panel) {
    throw new Error(`No webview frame shows ${entry}`);
  }
  return withSession(panel.target, async (send, attached) => {
    await send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
    await sleep(500);
    const heaps = [];
    for (const worker of attached().filter(({ type }) => type === "worker")) {
      await send("HeapProfiler.collectGarbage", {}, worker.sessionId);
      const usage = await send("Runtime.getHeapUsage", {}, worker.sessionId);
      heaps.push({ url: worker.url, usedSize: Number(usage.usedSize) });
    }
    return heaps;
  });
}

interface AttachedTarget {
  sessionId: string;
  type: string;
  url: string;
}

type SessionSend = (
  method: string,
  params?: Record<string, unknown>,
  sessionId?: string,
) => Promise<Record<string, unknown>>;

/** Runs `use` over one CDP socket, with each command optionally routed to an attached target's session. */
function withSession<T>(
  webSocketUrl: string,
  use: (send: SessionSend, attached: () => AttachedTarget[]) => Promise<T>,
  timeoutMs = 30_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const pending = new Map<
      number,
      {
        resolve: (r: Record<string, unknown>) => void;
        reject: (e: Error) => void;
      }
    >();
    const targets: AttachedTarget[] = [];
    let nextId = 1;
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`CDP session timed out: ${webSocketUrl}`));
    }, timeoutMs);
    const send: SessionSend = (method, params = {}, sessionId) =>
      new Promise((resolveCommand, rejectCommand) => {
        const id = nextId++;
        pending.set(id, { resolve: resolveCommand, reject: rejectCommand });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.method === "Target.attachedToTarget") {
        const { sessionId, targetInfo } = message.params;
        targets.push({ sessionId, type: targetInfo.type, url: targetInfo.url });
        return;
      }
      const waiting = pending.get(message.id);
      if (!waiting) {
        return;
      }
      pending.delete(message.id);
      if (message.error) {
        waiting.reject(
          new Error(`CDP failed: ${JSON.stringify(message.error)}`),
        );
      } else {
        waiting.resolve(message.result ?? {});
      }
    });
    socket.addEventListener("open", () => {
      use(send, () => [...targets]).then(
        (value) => {
          clearTimeout(timeout);
          socket.close();
          resolve(value);
        },
        (error) => {
          clearTimeout(timeout);
          socket.close();
          reject(error);
        },
      );
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error(`CDP socket failed: ${webSocketUrl}`));
    });
  });
}

/** Every log and console entry the target has buffered; both `enable` calls replay them before they answer. */
function logEntries(webSocketUrl: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const texts: string[] = [];
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`CDP Log.enable timed out: ${webSocketUrl}`));
    }, 5_000);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method: "Log.enable" }));
      socket.send(JSON.stringify({ id: 2, method: "Console.enable" }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.method === "Log.entryAdded") {
        texts.push(String(message.params.entry.text));
        return;
      }
      if (message.method === "Console.messageAdded") {
        texts.push(String(message.params.message.text));
        return;
      }
      if (message.id === 2) {
        clearTimeout(timeout);
        setTimeout(() => {
          socket.close();
          resolve(texts);
        }, 300);
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error(`CDP socket failed: ${webSocketUrl}`));
    });
  });
}

async function findWorkbenchPageTarget(
  port: string,
  host: string,
): Promise<CdpTarget> {
  const targets = await listTargets(port);
  const page = targets.find((target) => matchesWorkbenchPage(target, host));
  if (!page) {
    throw new Error(
      `Workbench page for ${host} not found among CDP targets: ${JSON.stringify(
        targets.map(({ type, title, url }) => ({ type, title, url })),
      )}`,
    );
  }
  return page;
}

async function listTargets(port: string): Promise<CdpTarget[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) {
    throw new Error(`CDP target request failed: ${response.status}`);
  }
  return (await response.json()) as CdpTarget[];
}

function evaluateContexts(
  webSocketUrl: string,
  expression: string,
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const pendingContextIds = new Set<number>();
    const slots = new Map<number, ContextSlot>();
    let dispatched: DispatchedContext[] = [];
    let evaluateStarted = false;
    let contextTimer: NodeJS.Timeout | undefined;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      clearTimeout(contextTimer);
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    };
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };
    const maybeComplete = () => {
      if (settled || !evaluateStarted) {
        return;
      }
      if (!allDispatchedSlotsSettled(dispatched, slots)) {
        return;
      }
      finish(() => {
        try {
          resolve(assembleEvaluationResults(dispatched, slots));
        } catch (error) {
          reject(
            error instanceof Error
              ? error
              : new Error(String(error ?? "CDP evaluation assembly failed")),
          );
        }
      });
    };
    const timeout = setTimeout(
      () =>
        finish(() =>
          reject(
            new Error(`CDP context evaluation timed out: ${webSocketUrl}`),
          ),
        ),
      5_000,
    );
    const dispatchEvaluations = () => {
      evaluateStarted = true;
      const contextIds = [...pendingContextIds];
      pendingContextIds.clear();
      if (contextIds.length === 0) {
        finish(() => resolve([]));
        return;
      }
      dispatched = contextIds.map((contextId, index) => ({
        requestId: 100 + index,
        contextId,
      }));
      for (const { requestId } of dispatched) {
        slots.set(requestId, { state: "pending" });
      }
      for (const { requestId, contextId } of dispatched) {
        socket.send(
          JSON.stringify({
            id: requestId,
            method: "Runtime.evaluate",
            params: {
              contextId,
              expression,
              awaitPromise: true,
              returnByValue: true,
            },
          }),
        );
      }
    };
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.method === "Runtime.executionContextCreated") {
        if (!evaluateStarted) {
          pendingContextIds.add(message.params.context.id);
        }
        return;
      }
      if (message.method === "Runtime.executionContextDestroyed") {
        const contextId = message.params.executionContextId as number;
        if (!evaluateStarted) {
          pendingContextIds.delete(contextId);
          return;
        }
        const entry = dispatched.find(
          ({ contextId: dispatchedId }) => dispatchedId === contextId,
        );
        if (entry && slots.get(entry.requestId)?.state === "pending") {
          slots.set(entry.requestId, { state: "destroyed" });
          maybeComplete();
        }
        return;
      }
      if (message.id === 1) {
        if (pendingContextIds.size === 0) {
          // Cursor can acknowledge Runtime.enable before reporting existing contexts.
          contextTimer = setTimeout(dispatchEvaluations, 100);
        } else {
          dispatchEvaluations();
        }
        return;
      }
      if (typeof message.id !== "number" || message.id < 100) {
        return;
      }
      if (message.error) {
        slots.set(message.id, {
          state: "error",
          error: JSON.stringify(message.error),
        });
      } else if (message.result.exceptionDetails) {
        slots.set(message.id, {
          state: "error",
          error: JSON.stringify(message.result.exceptionDetails),
        });
      } else {
        slots.set(message.id, {
          state: "ok",
          value: message.result.result.value,
        });
      }
      maybeComplete();
    });
    socket.addEventListener("error", () => {
      finish(() => reject(new Error(`CDP socket failed: ${webSocketUrl}`)));
    });
  });
}

/** Evaluates `expression` in the workbench page and returns the first context's non-null value. */
export async function evaluateWorkbench<T>(
  port: string,
  host: string,
  expression: string,
): Promise<T | undefined> {
  const target = await findWorkbenchPageTarget(port, validateSmokeHost(host));
  const values = await evaluateContexts(
    target.webSocketDebuggerUrl!,
    expression,
  );
  return values.find((value) => value !== undefined && value !== null) as
    T | undefined;
}

/** PNG of the whole workbench window as the user sees it, webviews included. */
export async function captureWorkbenchScreenshot(
  port: string,
  host: string,
): Promise<Buffer> {
  const target = await findWorkbenchPageTarget(port, validateSmokeHost(host));
  const result = await sendCommand(
    target.webSocketDebuggerUrl!,
    "Page.captureScreenshot",
    { format: "png", fromSurface: true },
    10_000,
  );
  if (typeof result.data !== "string") {
    throw new Error("CDP screenshot returned no data");
  }
  return Buffer.from(result.data, "base64");
}

/** Sends one CDP command to `webSocketUrl` and resolves with its result. */
function sendCommand(
  webSocketUrl: string,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 5_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`CDP ${method} timed out`));
    }, timeoutMs);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method, params }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) {
        return;
      }
      clearTimeout(timeout);
      socket.close();
      if (message.error) {
        reject(
          new Error(`CDP ${method} failed: ${JSON.stringify(message.error)}`),
        );
        return;
      }
      resolve(message.result ?? {});
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error(`CDP ${method} socket failed`));
    });
  });
}

function isWebviewPaintMetric(value: unknown): value is WebviewPaintMetric {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<WebviewPaintMetric>;
  return (
    typeof candidate.entry === "string" &&
    typeof candidate.timeOrigin === "number" &&
    typeof candidate.firstContentfulPaint === "number" &&
    typeof candidate.bodyText === "string" &&
    Array.isArray(candidate.stylesheets) &&
    typeof candidate.codiconFont === "boolean"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
