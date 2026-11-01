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

const NOTHING_ON = {
  offTypes: [],
  offTags: [],
  softened: [],
  dimmed: [],
  offEdgeGroups: [],
};

describe("lineage scope in workspace state", () => {
  it("reads nothing switched off when the workspace holds no scope", () => {
    expect(readLineageScope(workspaceWith().store)).toEqual(NOTHING_ON);
  });

  it("stores the scope under one workspace key and reads it back", () => {
    const { store, state } = workspaceWith();
    const scope = {
      offTypes: ["source"],
      offTags: ["nightly"],
      softened: ["model.a"],
      dimmed: ["model.b"],
      offEdgeGroups: ["source"],
    };
    persistLineageScope(store, scope);
    expect(state.get("lineage.scope")).toEqual(scope);
    expect(readLineageScope(store)).toEqual(scope);
  });

  it("drops names that are not strings and keeps each name once", () => {
    const { store } = workspaceWith({
      offTypes: ["seed", "seed", 3, null],
      offTags: "nightly",
      softened: ["model.a", "model.a"],
      dimmed: [{ id: "model.b" }],
      offEdgeGroups: ["model", "model", 4],
    });
    expect(readLineageScope(store)).toEqual({
      ...NOTHING_ON,
      offTypes: ["seed"],
      softened: ["model.a"],
      offEdgeGroups: ["model"],
    });
  });

  it("reads a scope stored before the busy-node list with nothing softened or dimmed", () => {
    const { store } = workspaceWith({ offTypes: ["seed"], offTags: [] });
    expect(readLineageScope(store)).toEqual({
      ...NOTHING_ON,
      offTypes: ["seed"],
    });
  });

  it("reads a scope stored before the edge groups with every edge group on", () => {
    const { store } = workspaceWith({
      offTypes: [],
      offTags: [],
      softened: [],
      dimmed: [],
    });
    expect(readLineageScope(store)).toEqual(NOTHING_ON);
  });

  it("tolerates a stored value that is not an object", () => {
    expect(readLineageScope(workspaceWith(null).store)).toEqual(NOTHING_ON);
  });
});
