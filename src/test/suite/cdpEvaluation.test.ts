import { describe, expect, it } from "vitest";
// ast-grep-ignore: ts-suite-no-harness-import -- pins the fail-closed reject rules of the CDP evaluation
import type { ContextSlot } from "../smoke/cdpEvaluation";
// ast-grep-ignore: ts-suite-no-harness-import -- pins the fail-closed reject rules of the CDP evaluation
import {
  allDispatchedSlotsSettled,
  assembleEvaluationResults,
  evaluationSlot,
  goneReason,
  isPainted,
} from "../smoke/cdpEvaluation";

describe("CDP evaluation result assembly", () => {
  const dispatched = [
    { requestId: 100, contextId: 1 },
    { requestId: 101, contextId: 2 },
  ];

  it("rejects missing slots for dispatched contexts", () => {
    const slots = new Map<number, ContextSlot>([
      [100, { state: "ok", value: "first" }],
    ]);

    expect(() => assembleEvaluationResults(dispatched, slots)).toThrow(
      /missing result for context 2/,
    );
  });

  it("rejects destroyed contexts that never returned a value", () => {
    const slots = new Map<number, ContextSlot>([
      [100, { state: "ok", value: "first" }],
      [101, { state: "destroyed" }],
    ]);

    expect(() => assembleEvaluationResults(dispatched, slots)).toThrow(
      /destroyed before evaluation completed/,
    );
  });

  it("rejects evaluation errors causally", () => {
    const slots = new Map<number, ContextSlot>([
      [100, { state: "error", error: "context invalidated" }],
    ]);

    expect(() => assembleEvaluationResults([dispatched[0]], slots)).toThrow(
      /context invalidated/,
    );
  });

  it("waits until every dispatched slot leaves pending", () => {
    const slots = new Map<number, ContextSlot>([
      [100, { state: "ok", value: "done" }],
      [101, { state: "pending" }],
    ]);

    expect(allDispatchedSlotsSettled(dispatched, slots)).toBe(false);
    slots.set(101, { state: "ok", value: "done" });
    expect(allDispatchedSlotsSettled(dispatched, slots)).toBe(true);
  });
});

describe("CDP evaluation replies and paint checks", () => {
  it("maps a reply to an error slot, an exception slot or an ok slot", () => {
    expect(
      evaluationSlot({ error: { code: -1 }, result: { result: { value: 1 } } }),
    ).toEqual({
      state: "error",
      error: '{"code":-1}',
    });
    expect(
      evaluationSlot({
        result: { exceptionDetails: { text: "boom" }, result: { value: 1 } },
      }),
    ).toEqual({ state: "error", error: '{"text":"boom"}' });
    expect(evaluationSlot({ result: { result: { value: "ok" } } })).toEqual({
      state: "ok",
      value: "ok",
    });
  });

  it("reports a webview painted only with its body, own stylesheet, codicons and font", () => {
    const paint = {
      entry: "docs",
      timeOrigin: 1,
      firstContentfulPaint: 2,
      bodyText: "Docs",
      stylesheets: ["https://x/docs.css", "https://x/codicon.css"],
      codiconFont: true,
    };
    expect(isPainted("docs", paint)).toBe(true);
    expect(isPainted("docs", { ...paint, bodyText: "" })).toBe(false);
    expect(
      isPainted("docs", { ...paint, stylesheets: ["https://x/codicon.css"] }),
    ).toBe(false);
    expect(isPainted("docs", { ...paint, codiconFont: false })).toBe(false);
  });

  it("names why a panel scan found no frame showing the entry", () => {
    expect(goneReason({ frames: 0, skipped: [] })).toBe("no-frames");
    expect(goneReason({ frames: 2, skipped: ["gone", "gone"] })).toBe(
      "frames-errored",
    );
    expect(goneReason({ frames: 2, skipped: ["gone"] })).toBe("other-entries");
  });
});
