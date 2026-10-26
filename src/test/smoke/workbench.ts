import { commands } from "vscode";
import { sleep } from "../async";
import { isWorkbenchNotificationSnapshot } from "./cdpEvaluation";
import type { CdpTarget } from "./cdpTransport";
import { evaluateContexts, listTargets, sendCommand } from "./cdpTransport";
import type { NotificationSettleState } from "./notificationToasts";
import {
  aggregateWorkbenchNotificationSnapshots,
  collectWorkbenchNotifications,
  nextNotificationSettleState,
  NOTIFICATION_CENTER_ITEM_SELECTOR,
  NOTIFICATION_CLEAR_MS,
  NOTIFICATION_TOAST_ITEM_SELECTOR,
  notificationsSettled,
  splitHostNotices,
} from "./notificationToasts";

export type SmokeHost = "vscode" | "cursor";

const SHOW_NOTIFICATIONS = "notifications.showList";
const HIDE_NOTIFICATIONS = "notifications.hideList";

export function validateSmokeHost(host: string): SmokeHost {
  if (host === "vscode" || host === "cursor") {
    return host;
  }
  throw new Error(`Unsupported smoke host: ${host}`);
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
    : new Error(
        lastError === undefined
          ? "CDP notification read failed"
          : JSON.stringify(lastError),
      );
}

/**
 * Fails when the workbench shows any notification, toast or centered, other than the host's slow-start notice,
 * which is logged instead.
 */
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
    const { hostNotices, unexpected } = splitHostNotices(notifications);
    if (hostNotices.length > 0) {
      console.log(`FPU_SMOKE_HOST_NOTICE=${JSON.stringify(hostNotices)}`);
    }
    if (unexpected.length > 0) {
      throw new Error(
        `Unexpected workbench notifications: ${JSON.stringify(unexpected)}`,
      );
    }
  } finally {
    await commands.executeCommand(HIDE_NOTIFICATIONS);
  }
}

const NOTIFICATION_POLL_MS = 250;

/** How long after opening the notification center before the first read, so its list has rendered. */
const NOTIFICATION_RENDER_MS = 300;

/**
 * Waits for the workbench's notifications to clear, so a notification that is still running (for example the language
 * client's work-done progress) is not read as an unexpected one. The wait ends when no notification has shown for
 * about 2s, or at `timeoutMs`. Anything still showing at the deadline fails the assertion that follows. It does not
 * tell progress from errors. A CDP read failure throws, as `readWorkbenchNotificationTexts` does after its own retries.
 */
export async function waitForWorkbenchNotificationsToSettle(
  cdpPort: string,
  smokeHost: string,
  timeoutMs = 30_000,
): Promise<void> {
  const host = validateSmokeHost(smokeHost);
  const deadline = Date.now() + timeoutMs;
  await commands.executeCommand(SHOW_NOTIFICATIONS);
  try {
    await sleep(NOTIFICATION_RENDER_MS);
    let state: NotificationSettleState = {};
    for (;;) {
      const texts = await readWorkbenchNotificationTexts(cdpPort, host);
      const now = Date.now();
      state = nextNotificationSettleState(state, texts.length, now);
      if (notificationsSettled(state, now, deadline, NOTIFICATION_CLEAR_MS)) {
        return;
      }
      await sleep(NOTIFICATION_POLL_MS);
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
    | T
    | undefined;
}

/** The smallest workbench window a screenshot is taken in, so a panel's content is large enough to judge. */
const EVIDENCE_WINDOW = { width: 1600, height: 1100 };

/** The window sizing the first screenshot of the run starts; later screenshots reuse its result. */
let evidenceWindow: Promise<WindowSize | undefined> | undefined;

/** The workbench window's outer size from the run's first screenshot, for a checkpoint's record. */
export const evidenceWindowSize = (): Promise<WindowSize | undefined> =>
  evidenceWindow ?? Promise.resolve(undefined);

/** The workbench window's outer size in CSS pixels after `ensureEvidenceWindow`, for a checkpoint's record. */
interface WindowSize {
  width: number;
  height: number;
}

/**
 * The workbench window's outer size, for a checkpoint's record. VS Code serves no CDP Browser domain to resize it,
 * so the window is as large as `window.newWindowDimensions: "maximized"` makes it on the display (Xvfb runs a
 * 1920x1200 screen). Warns when it is smaller than `EVIDENCE_WINDOW`, so an undersized run is visible in the log.
 */
async function ensureEvidenceWindow(
  port: string,
  host: string,
): Promise<WindowSize | undefined> {
  const size = await evaluateWorkbench<WindowSize>(
    port,
    host,
    "({ width: window.outerWidth, height: window.outerHeight })",
  );
  if (
    size &&
    (size.width < EVIDENCE_WINDOW.width || size.height < EVIDENCE_WINDOW.height)
  ) {
    console.warn(
      `FPU_SMOKE_WINDOW ${size.width}x${size.height} is below ${EVIDENCE_WINDOW.width}x${EVIDENCE_WINDOW.height}`,
    );
  }
  return size;
}

/** PNG of the whole workbench window as the user sees it, webviews included. */
export async function captureWorkbenchScreenshot(
  port: string,
  host: string,
): Promise<Buffer> {
  evidenceWindow ??= ensureEvidenceWindow(port, host);
  await evidenceWindow;
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
