import { describe, expect, it } from "vitest";
// ast-grep-ignore: ts-suite-no-harness-import -- pins the fail-closed aggregation and host-notice rules
import {
  aggregateWorkbenchNotificationSnapshots,
  splitHostNotices,
} from "../smoke/notificationToasts";

describe("workbench notification aggregation", () => {
  it("unions toasts from later contexts and ignores early empty contexts", () => {
    expect(
      aggregateWorkbenchNotificationSnapshots([
        { workbench: false, toasts: [] },
        { workbench: true, toasts: ["Host toast"] },
      ]).toasts,
    ).toEqual(["Host toast"]);
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

describe("splitHostNotices", () => {
  it("expects the host's slow-start notice, with or without its action labels", () => {
    expect(
      splitHostNotices([
        "Reload Window\nCopy\nExtension host did not start in 10 seconds",
        "Extension host did not start in 20 seconds",
      ]),
    ).toEqual({
      hostNotices: [
        "Reload Window\nCopy\nExtension host did not start in 10 seconds",
        "Extension host did not start in 20 seconds",
      ],
      unexpected: [],
    });
  });

  it("keeps every other notification unexpected, including one that only mentions the host", () => {
    expect(
      splitHostNotices([
        "Extension host terminated unexpectedly",
        "Fusion Power User: dbt not found. Extension host did not start in 10 seconds",
      ]),
    ).toEqual({
      hostNotices: [],
      unexpected: [
        "Extension host terminated unexpectedly",
        "Fusion Power User: dbt not found. Extension host did not start in 10 seconds",
      ],
    });
  });
});
