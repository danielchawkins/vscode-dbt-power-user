import { describe, expect, it } from "vitest";
import {
  persistLineageLayout,
  readLineageLayout,
} from "../../features/lineage/lineageLayout";

type Store = Parameters<typeof readLineageLayout>[0];

/** A workspace-state store over `initial`, which `set` writes and `get` reads back. */
const workspaceWith = (initial?: unknown) => {
  const state = new Map<string, unknown>(
    initial === undefined ? [] : [["lineage.layout", initial]],
  );
  const store: Store = {
    getFromWorkspaceState: <T>(key: string) => state.get(key) as T | undefined,
    setToWorkspaceState: (key, value) => {
      state.set(key, value);
    },
  };
  return { store, state };
};

describe("lineage layout in workspace state", () => {
  it("reads the default spacing when the workspace holds no layout", () => {
    expect(readLineageLayout(workspaceWith().store)).toEqual({
      spacing: "default",
    });
  });

  it("reads the default spacing for a stored value it does not know", () => {
    expect(
      readLineageLayout(workspaceWith({ spacing: "sparse" }).store),
    ).toEqual({ spacing: "default" });
  });

  it("stores the layout under one workspace key and reads it back", () => {
    const { store, state } = workspaceWith();
    persistLineageLayout(store, { spacing: "compact" });
    expect(state.get("lineage.layout")).toEqual({ spacing: "compact" });
    expect(readLineageLayout(store)).toEqual({ spacing: "compact" });
  });
});
