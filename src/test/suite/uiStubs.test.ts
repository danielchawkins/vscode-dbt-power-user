import { describe, expect, it } from "vitest";
import * as vscode from "vscode";
import {
  installUiStubs,
  STUBBED_WINDOW_FUNCTIONS,
  type StubbedWindowFunction,
  withUiStubs,
} from "../integration/uiStubs";

const windowRecord = vscode.window as unknown as Record<string, unknown>;

/** The value and presence of each stubbed `window` function as the test starts. */
function originalsOf() {
  return STUBBED_WINDOW_FUNCTIONS.map((name) => ({
    name,
    value: windowRecord[name],
    own: Object.prototype.hasOwnProperty.call(windowRecord, name),
  }));
}

function expectOriginals(originals: ReturnType<typeof originalsOf>) {
  for (const { name, value, own } of originals) {
    expect(windowRecord[name], name).toBe(value);
    expect(Object.prototype.hasOwnProperty.call(windowRecord, name), name).toBe(
      own,
    );
  }
}

describe("uiStubs", () => {
  it("answers scripted calls in queue order and then throws unscripted", () => {
    const originals = originalsOf();
    const restore = installUiStubs({ showQuickPick: ["first", "second"] });
    try {
      const pick = windowRecord.showQuickPick as (
        ...args: unknown[]
      ) => unknown;
      expect(pick([])).toBe("first");
      expect(pick([])).toBe("second");
      expect(() => pick([])).toThrow("unscripted window.showQuickPick");
    } finally {
      restore();
    }
    expectOriginals(originals);
  });

  it("withUiStubs restores every original and rethrows when the body throws", async () => {
    const originals = originalsOf();
    await expect(
      withUiStubs({}, () => {
        throw new Error("body failed");
      }),
    ).rejects.toThrow("body failed");
    expectOriginals(originals);
  });

  it("withUiStubs restores every original when a scripted-out call throws unscripted", async () => {
    const originals = originalsOf();
    await expect(
      withUiStubs({ showInformationMessage: [] }, () =>
        (
          windowRecord.showInformationMessage as (...args: unknown[]) => unknown
        )("no answer left"),
      ),
    ).rejects.toThrow("unscripted window.showInformationMessage");
    expectOriginals(originals);
  });

  it("withUiStubs restores the originals after an async body rejects", async () => {
    const originals = originalsOf();
    await expect(
      withUiStubs({ showWarningMessage: ["Clear"] }, async () => {
        await Promise.resolve();
        throw new Error("late failure");
      }),
    ).rejects.toThrow("late failure");
    expectOriginals(originals);
  });

  it("a second install after restore starts clean", () => {
    const originals = originalsOf();
    const restoreFirst = installUiStubs({ showQuickPick: ["left over"] });
    restoreFirst();
    expectOriginals(originals);

    const restoreSecond = installUiStubs({});
    try {
      const pick = windowRecord.showQuickPick as (
        ...args: unknown[]
      ) => unknown;
      expect(() => pick([])).toThrow("unscripted window.showQuickPick");
    } finally {
      restoreSecond();
    }
    expectOriginals(originals);
  });

  it("restore deletes showInputBox, which the unit mock window does not have", () => {
    expect(
      Object.prototype.hasOwnProperty.call(windowRecord, "showInputBox"),
    ).toBe(false);
    const restore = installUiStubs({ showInputBox: ["typed"] });
    try {
      expect(
        Object.prototype.hasOwnProperty.call(windowRecord, "showInputBox"),
      ).toBe(true);
    } finally {
      restore();
    }
    expect(
      Object.prototype.hasOwnProperty.call(windowRecord, "showInputBox"),
    ).toBe(false);
  });

  it("records every call's arguments, including unscripted ones", () => {
    const calls: Partial<Record<StubbedWindowFunction, unknown[][]>> = {};
    const restore = installUiStubs({ showOpenDialog: [undefined] }, calls);
    try {
      const open = windowRecord.showOpenDialog as (
        ...args: unknown[]
      ) => unknown;
      expect(open({ canSelectFolders: true })).toBeUndefined();
      expect(() => open({ canSelectFolders: false })).toThrow(
        "unscripted window.showOpenDialog",
      );
    } finally {
      restore();
    }
    expect(calls.showOpenDialog).toEqual([
      [{ canSelectFolders: true }],
      [{ canSelectFolders: false }],
    ]);
  });
});
