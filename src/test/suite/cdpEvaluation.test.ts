import {
  allDispatchedSlotsSettled,
  assembleEvaluationResults,
  ContextSlot,
} from "../smoke/cdpEvaluation";

describe("CDP evaluation result assembly", () => {
  const dispatched = [
    { requestId: 100, contextId: 1 },
    { requestId: 101, contextId: 2 },
  ];

  it("assembles successful results in dispatch order", () => {
    const slots = new Map<number, ContextSlot>([
      [100, { state: "ok", value: { workbench: false, toasts: [] } }],
      [
        101,
        { state: "ok", value: { workbench: true, toasts: ["Host toast"] } },
      ],
    ]);

    expect(assembleEvaluationResults(dispatched, slots)).toEqual([
      { workbench: false, toasts: [] },
      { workbench: true, toasts: ["Host toast"] },
    ]);
  });

  it("ignores late contexts that were never dispatched", () => {
    const slots = new Map<number, ContextSlot>([
      [100, { state: "ok", value: "first" }],
      [101, { state: "ok", value: "second" }],
      [102, { state: "ok", value: "late" }],
    ]);

    expect(assembleEvaluationResults(dispatched, slots)).toEqual([
      "first",
      "second",
    ]);
  });

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
