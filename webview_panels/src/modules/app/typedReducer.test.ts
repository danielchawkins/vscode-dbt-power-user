import { describe, expect, it } from "vitest";
import { appReducer, initialState, updateTheme } from "./appReducer";
import { typedReducer } from "./typedReducer";
import { Themes } from "./types";

describe("typedReducer", () => {
  const counter = typedReducer<
    { n: number },
    { add: number; reset: undefined }
  >({
    add: (state, by) => ({ n: state.n + by }),
    reset: () => ({ n: 0 }),
  });

  it("creates actions named after their handler", () => {
    expect(counter.actions.add(2)).toEqual({ type: "add", payload: 2 });
  });

  it("applies the handler for the action type without mutating state", () => {
    const state = { n: 1 };
    expect(counter.reducer(state, counter.actions.add(2))).toEqual({ n: 3 });
    expect(counter.reducer(state, counter.actions.reset(undefined))).toEqual({
      n: 0,
    });
    expect(state).toEqual({ n: 1 });
  });

  it("returns the same state for an action it has no handler for", () => {
    const state = { n: 1 };
    const unknown = { type: "toString", payload: 1 } as never;
    expect(counter.reducer(state, unknown)).toBe(state);
    expect(
      counter.reducer(state, { type: "missing", payload: 1 } as never),
    ).toBe(state);
  });
});

describe("appReducer", () => {
  it("updates the theme", () => {
    expect(appReducer(initialState, updateTheme(Themes.Light))).toEqual({
      theme: Themes.Light,
    });
  });
});
