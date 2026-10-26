import type { WorkbenchNotificationSnapshot } from "./notificationToasts";

export interface DispatchedContext {
  requestId: number;
  contextId: number;
}

export type ContextSlot =
  | { state: "pending" }
  | { state: "ok"; value: unknown }
  | { state: "error"; error: string }
  | { state: "destroyed" };

export function assembleEvaluationResults(
  dispatched: readonly DispatchedContext[],
  slots: ReadonlyMap<number, ContextSlot>,
): unknown[] {
  const values: unknown[] = [];
  for (const { requestId, contextId } of dispatched) {
    const slot = slots.get(requestId);
    if (!slot || slot.state === "pending") {
      throw new Error(
        `CDP context evaluation missing result for context ${contextId}`,
      );
    }
    if (slot.state === "destroyed") {
      throw new Error(
        `CDP context ${contextId} was destroyed before evaluation completed`,
      );
    }
    if (slot.state === "error") {
      throw new Error(`CDP context evaluation failed: ${slot.error}`);
    }
    values.push(slot.value);
  }
  return values;
}

export function allDispatchedSlotsSettled(
  dispatched: readonly DispatchedContext[],
  slots: ReadonlyMap<number, ContextSlot>,
): boolean {
  return dispatched.every(({ requestId }) => {
    const slot = slots.get(requestId);
    return slot !== undefined && slot.state !== "pending";
  });
}

/** The slot a `Runtime.evaluate` reply leaves: its protocol error, its thrown exception, or its value. */
export function evaluationSlot(reply: {
  error?: unknown;
  result: { exceptionDetails?: unknown; result: { value: unknown } };
}): ContextSlot {
  if (reply.error) {
    return { state: "error", error: JSON.stringify(reply.error) };
  }
  if (reply.result.exceptionDetails) {
    return {
      state: "error",
      error: JSON.stringify(reply.result.exceptionDetails),
    };
  }
  return { state: "ok", value: reply.result.result.value };
}

export function isWorkbenchNotificationSnapshot(
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

/** A webview frame's paint, read from inside the frame: its entry, load time, text, stylesheets and codicon font. */
export interface WebviewPaintMetric {
  entry: string;
  timeOrigin: number;
  firstContentfulPaint: number;
  bodyText: string;
  stylesheets: string[];
  codiconFont: boolean;
}

export function isWebviewPaintMetric(
  value: unknown,
): value is WebviewPaintMetric {
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

/** Whether a paint shows the webview `entry` rendered: body text, its stylesheet, codicon stylesheet and font. */
export function isPainted(entry: string, value: WebviewPaintMetric): boolean {
  return (
    value.bodyText !== "" &&
    value.stylesheets.some((href) => href.endsWith(`/${entry}.css`)) &&
    value.stylesheets.some((href) => href.endsWith("/codicon.css")) &&
    value.codiconFont
  );
}

/** Why a panel scan found no frame showing the entry: no frames at all, frames that all failed, or other entries. */
export function goneReason(scan: {
  frames: number;
  skipped: readonly string[];
}): "no-frames" | "frames-errored" | "other-entries" {
  if (scan.frames === 0) {
    return "no-frames";
  }
  return scan.skipped.length === scan.frames
    ? "frames-errored"
    : "other-entries";
}
