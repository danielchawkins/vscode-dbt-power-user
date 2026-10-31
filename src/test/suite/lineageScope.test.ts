import { describe, expect, it } from "vitest";
import {
  persistLineageScope,
  readLineageScope,
} from "../../features/lineage/lineageScope";

type Store = Parameters<typeof readLineageScope>[0];

/** A workspace-state store over `initial`, which `set` writes and `get` reads back. */
const workspaceWith = (initial?: unknown) => {
  const state = new Map<string, unknown>(
    initial === undefined ? [] : [["lineage.scope", initial]],
  );
  const store: Store = {
    getFromWorkspaceState: <T>(key: string) => state.get(key) as T | undefined,
    setToWorkspaceState: (key, value) => {
      state.set(key, value);
    },
  };
  return { store, state };
};

describe("lineage scope in workspace state", () => {
  it("reads nothing switched off when the workspace holds no scope", () => {
    expect(readLineageScope(workspaceWith().store)).toEqual({
      offTypes: [],
      offTags: [],
    });
  });

  it("stores the scope under one workspace key and reads it back", () => {
    const { store, state } = workspaceWith();
    persistLineageScope(store, { offTypes: ["source"], offTags: ["nightly"] });
    expect(state.get("lineage.scope")).toEqual({
      offTypes: ["source"],
      offTags: ["nightly"],
    });
    expect(readLineageScope(store)).toEqual({
      offTypes: ["source"],
      offTags: ["nightly"],
    });
  });

  it("drops names that are not strings and keeps each name once", () => {
    const { store } = workspaceWith({
      offTypes: ["seed", "seed", 3, null],
      offTags: "nightly",
    });
    expect(readLineageScope(store)).toEqual({
      offTypes: ["seed"],
      offTags: [],
    });
  });

  it("tolerates a stored value that is not an object", () => {
    expect(readLineageScope(workspaceWith(null).store)).toEqual({
      offTypes: [],
      offTags: [],
    });
  });
});
