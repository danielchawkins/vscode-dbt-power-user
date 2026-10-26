import { describe, expect, it } from "vitest";
// ast-grep-ignore: ts-suite-no-harness-import -- pins the fail-closed reject rules of the CDP evaluation
import type { ContextSlot } from "../smoke/cdpEvaluation";
// ast-grep-ignore: ts-suite-no-harness-import -- pins the fail-closed reject rules of the CDP evaluation
import {
  allDispatchedSlotsSettled,
  assembleEvaluationResults,
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
