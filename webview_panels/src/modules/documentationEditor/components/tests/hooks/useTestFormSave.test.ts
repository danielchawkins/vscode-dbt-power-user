import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TestOperation } from "../testEdits";
import useTestFormSave from "./useTestFormSave";

describe("useTestFormSave", () => {
  it("is not saving after a request that names no test", async () => {
    const { result } = renderHook(() => useTestFormSave());

    await act(async () => {
      await result.current.handleSave({}, "id", TestOperation.CREATE);
    });

    expect(result.current.isSaving).toBe(false);
  });
});
