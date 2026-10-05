import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useHandleMeasurement } from "./useHandleMeasurement";

const updateNodeInternals = vi.fn();
vi.mock("@xyflow/react", () => ({
  useUpdateNodeInternals: () => updateNodeInternals,
}));

describe("useHandleMeasurement", () => {
  it("re-measures all nodes in one call per new node set", () => {
    const first = [{ id: "a" }, { id: "b" }];
    const view = renderHook(({ nodes }) => useHandleMeasurement(nodes), {
      initialProps: { nodes: first },
    });
    view.rerender({ nodes: first });
    view.rerender({ nodes: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    expect(updateNodeInternals.mock.calls).toEqual([
      [["a", "b"]],
      [["a", "b", "c"]],
    ]);
  });
});
