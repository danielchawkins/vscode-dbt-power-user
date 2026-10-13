export const NOTIFICATION_CENTER_ITEM_SELECTOR =
  ".notifications-center .notification-list-item";

export const NOTIFICATION_TOAST_ITEM_SELECTOR =
  ".notifications-toasts .notification-toast";

export interface NotificationDomNode {
  innerText?: string;
}

export interface NotificationDomDocument {
  querySelector(selector: string): NotificationDomNode | null;
  querySelectorAll?(selector: string): NotificationDomNode[];
}

export interface WorkbenchNotificationSnapshot {
  workbench: boolean;
  toasts: string[];
}

export function collectWorkbenchNotifications(
  document: NotificationDomDocument,
  centerItemSelector: string,
  toastItemSelector: string,
  maxItems = 20,
  maxLength = 500,
): WorkbenchNotificationSnapshot {
  const workbench = document.querySelector(".monaco-workbench") !== null;
  const texts = new Set<string>();
  for (const selector of [centerItemSelector, toastItemSelector]) {
    const items = document.querySelectorAll?.(selector) ?? [];
    for (const item of items) {
      const text = item.innerText?.trim();
      if (text) {
        texts.add(text.slice(0, maxLength));
      }
    }
  }
  return { workbench, toasts: [...texts].slice(0, maxItems) };
}

/** How long notifications must stay clear before the workbench counts as settled. */
export const NOTIFICATION_CLEAR_MS = 2_000;

/** The start of the current run of empty reads, or undefined while the last read showed a notification. */
export interface NotificationSettleState {
  clearSince?: number;
}

/** Folds one read (its notification count, taken at `now`) into the clear window. */
export function nextNotificationSettleState(
  state: NotificationSettleState,
  count: number,
  now: number,
): NotificationSettleState {
  if (count > 0) {
    return {};
  }
  return { clearSince: state.clearSince ?? now };
}

/** True once the notifications have read empty across `clearMs`, or once `now` reaches the deadline. */
export function notificationsSettled(
  state: NotificationSettleState,
  now: number,
  deadline: number,
  clearMs: number,
): boolean {
  if (now >= deadline) {
    return true;
  }
  return state.clearSince !== undefined && now - state.clearSince >= clearMs;
}

export function aggregateWorkbenchNotificationSnapshots(
  snapshots: WorkbenchNotificationSnapshot[],
): WorkbenchNotificationSnapshot {
  let sawWorkbench = false;
  const toasts = new Set<string>();
  for (const snapshot of snapshots) {
    if (snapshot.workbench) {
      sawWorkbench = true;
    }
    for (const toast of snapshot.toasts) {
      toasts.add(toast);
    }
  }
  if (!sawWorkbench) {
    throw new Error("No CDP context reported a workbench page");
  }
  return { workbench: true, toasts: [...toasts] };
}
