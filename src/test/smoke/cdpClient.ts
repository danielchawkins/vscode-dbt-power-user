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
  viewPath: string;
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

export async function waitForWebviewPaint(
  port: string,
  viewPath: string,
  attempts = 100,
): Promise<WebviewPaintMetric> {
  let lastValue: WebviewPaintMetric | undefined;
  let lastTargets: CdpTarget[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
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
                viewPath: globalThis.viewPath,
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
            isWebviewPaintMetric(candidate) && candidate.viewPath === viewPath,
        );
        lastValue = value ?? lastValue;
        if (
          value &&
          value.bodyText &&
          value.stylesheets.some((href) => href.endsWith("/main.css")) &&
          value.stylesheets.some((href) => href.endsWith("/codicon.css")) &&
          value.codiconFont
        ) {
          return value;
        }
      }
    } catch {
      // The CDP endpoint can be briefly unavailable while a view is attaching.
    }
    if (attempt < attempts - 1) {
      await sleep(100);
    }
  }
  throw new Error(
    `Webview did not render with required assets: ${viewPath} ${JSON.stringify({
      lastValue,
      targets: lastTargets.map(({ type, title, url }) => ({
        type,
        title,
        url,
      })),
    })}`,
  );
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

function isWebviewPaintMetric(value: unknown): value is WebviewPaintMetric {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<WebviewPaintMetric>;
  return (
    typeof candidate.viewPath === "string" &&
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
