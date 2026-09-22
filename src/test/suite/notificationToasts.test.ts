import {
  aggregateWorkbenchNotificationSnapshots,
  collectWorkbenchNotifications,
  NOTIFICATION_CENTER_ITEM_SELECTOR,
  NOTIFICATION_TOAST_ITEM_SELECTOR,
  NotificationDomDocument,
  NotificationDomNode,
} from "../smoke/notificationToasts";

function item(text: string): NotificationDomNode {
  return { innerText: text };
}

function documentWith(
  workbench: boolean,
  entries: Record<string, NotificationDomNode[]>,
): NotificationDomDocument {
  return {
    querySelector(selector: string) {
      if (selector === ".monaco-workbench") {
        return workbench ? item("workbench") : null;
      }
      return null;
    },
    querySelectorAll(selector: string) {
      return entries[selector] ?? [];
    },
  };
}

describe("workbench notification collection", () => {
  it("collects center and toast items from the shared collector", () => {
    const document = documentWith(true, {
      [NOTIFICATION_CENTER_ITEM_SELECTOR]: [item("Center notification")],
      [NOTIFICATION_TOAST_ITEM_SELECTOR]: [item("Toast notification")],
    });

    expect(
      collectWorkbenchNotifications(
        document,
        NOTIFICATION_CENTER_ITEM_SELECTOR,
        NOTIFICATION_TOAST_ITEM_SELECTOR,
      ),
    ).toEqual({
      workbench: true,
      toasts: ["Center notification", "Toast notification"],
    });
  });

  it("bounds toast text length", () => {
    const document = documentWith(true, {
      [NOTIFICATION_TOAST_ITEM_SELECTOR]: [item("x".repeat(600))],
    });

    expect(
      collectWorkbenchNotifications(
        document,
        NOTIFICATION_CENTER_ITEM_SELECTOR,
        NOTIFICATION_TOAST_ITEM_SELECTOR,
        5,
        100,
      ).toasts,
    ).toEqual(["x".repeat(100)]);
  });
});

describe("workbench notification aggregation", () => {
  it("unions toasts from later contexts and ignores early empty contexts", () => {
    expect(
      aggregateWorkbenchNotificationSnapshots([
        { workbench: false, toasts: [] },
        { workbench: true, toasts: ["Host toast"] },
      ]).toasts,
    ).toEqual(["Host toast"]);
  });

  it("deduplicates toast text across contexts", () => {
    expect(
      aggregateWorkbenchNotificationSnapshots([
        { workbench: true, toasts: ["Duplicate"] },
        { workbench: true, toasts: ["Duplicate", "Unique"] },
      ]).toasts,
    ).toEqual(["Duplicate", "Unique"]);
  });

  it("fails closed when no context reports a workbench page", () => {
    expect(() =>
      aggregateWorkbenchNotificationSnapshots([
        { workbench: false, toasts: [] },
        { workbench: false, toasts: ["ignored"] },
      ]),
    ).toThrow(/No CDP context reported a workbench page/);
  });
});
