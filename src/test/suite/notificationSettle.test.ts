import { describe, expect, it } from "vitest";
// ast-grep-ignore: ts-suite-no-harness-import -- pins the fail-closed settle rules of the notification wait
import type { NotificationSettleState } from "../smoke/notificationToasts";
// ast-grep-ignore: ts-suite-no-harness-import -- pins the fail-closed settle rules of the notification wait
import {
  NOTIFICATION_CLEAR_MS,
  nextNotificationSettleState,
  notificationsSettled,
} from "../smoke/notificationToasts";

/** Replays (time, notification count) reads and reports whether the wait would have ended after the last one. */
function settledAfter(
  reads: Array<[now: number, count: number]>,
  deadline = Number.POSITIVE_INFINITY,
): boolean {
  let state: NotificationSettleState = {};
  let settled = false;
  for (const [now, count] of reads) {
    state = nextNotificationSettleState(state, count, now);
    settled = notificationsSettled(state, now, deadline, NOTIFICATION_CLEAR_MS);
    if (settled) {
      return true;
    }
  }
  return settled;
}

describe("workbench notification settle window", () => {
  it("settles after notifications read empty across the clear window", () => {
    expect(
      settledAfter([
        [0, 0],
        [1_000, 0],
        [2_000, 0],
      ]),
    ).toBe(true);
  });

  it("does not settle on a single empty read", () => {
    expect(settledAfter([[0, 0]])).toBe(false);
  });

  it("does not settle until the empty run spans the full window", () => {
    expect(
      settledAfter([
        [0, 0],
        [1_000, 0],
        [1_999, 0],
      ]),
    ).toBe(false);
  });

  it("resets the window when a notification appears between empty reads", () => {
    // Empty, then a notification, then empty again: the window restarts at the second empty read.
    expect(
      settledAfter([
        [0, 0],
        [500, 1],
        [1_000, 0],
        [2_500, 0],
      ]),
    ).toBe(false);
    expect(
      settledAfter([
        [0, 0],
        [500, 1],
        [1_000, 0],
        [3_000, 0],
      ]),
    ).toBe(true);
  });

  it("waits for a progress notification that appears after the first empty read", () => {
    // The first read is empty, and the progress toast starts about one poll later.
    const reads: Array<[number, number]> = [
      [0, 0],
      [300, 1],
      [550, 1],
      [800, 1],
      [1_050, 0],
      [3_050, 0],
    ];
    expect(settledAfter(reads.slice(0, 2))).toBe(false);
    expect(settledAfter(reads.slice(0, 4))).toBe(false);
    expect(settledAfter(reads)).toBe(true);
  });

  it("settles at the deadline even while notifications still show", () => {
    expect(
      settledAfter(
        [
          [0, 1],
          [1_000, 1],
          [2_000, 1],
        ],
        2_000,
      ),
    ).toBe(true);
    expect(
      settledAfter(
        [
          [0, 1],
          [1_000, 1],
        ],
        2_000,
      ),
    ).toBe(false);
  });

  it("settles at the deadline when the last read was non-empty", () => {
    const state = nextNotificationSettleState({}, 1, 1_000);
    expect(
      notificationsSettled(state, 1_000, 1_000, NOTIFICATION_CLEAR_MS),
    ).toBe(true);
  });
});
