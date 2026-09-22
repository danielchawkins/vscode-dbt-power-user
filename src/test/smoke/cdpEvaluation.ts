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
