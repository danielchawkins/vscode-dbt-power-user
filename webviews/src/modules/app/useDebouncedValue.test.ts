import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedValue } from "./useDebouncedValue";

describe("useDebouncedValue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps the old value until the delay passes since the last change", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 100),
      { initialProps: { value: "a" } },
    );
    rerender({ value: "ab" });
    act(() => vi.advanceTimersByTime(60));
    rerender({ value: "abc" });
    act(() => vi.advanceTimersByTime(60));
    expect(result.current).toBe("a");
    act(() => vi.advanceTimersByTime(40));
    expect(result.current).toBe("abc");
  });
});
