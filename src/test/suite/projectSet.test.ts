import { describe, expect, it, vi } from "vitest";
import type { Uri, WorkspaceFolder } from "vscode";
import {
  type Candidate,
  type DesiredProject,
  keepUnchanged,
  lookupOrder,
  mergeByRealpath,
  sameOrder,
} from "../../projects/registry/projectSet";

// The plan is pure, so it runs on plain objects: no VS Code mock is loaded.
const uri = (fsPath: string) => ({ fsPath }) as unknown as Uri;
const folder = {
  uri: uri("/workspace"),
  name: "workspace",
  index: 0,
} as unknown as WorkspaceFolder;

function candidate(
  root: string,
  overrides: Partial<Candidate> = {},
): Candidate {
  return {
    folder,
    root: uri(root),
    name: "analytics",
    realpathKey: root,
    origin: "folderRoot",
    ...overrides,
  };
}

describe("mergeByRealpath", () => {
  it("merges candidates that share a realpath and keeps each root spelling as an alias", () => {
    const desired = mergeByRealpath([
      candidate("/workspace/link", { realpathKey: "/workspace/real" }),
      candidate("/workspace/real", { realpathKey: "/workspace/real" }),
      candidate("/workspace/other"),
    ]);

    expect(desired.map((d) => d.root.fsPath)).toEqual([
      "/workspace/link",
      "/workspace/other",
    ]);
    expect(desired[0]?.aliases).toEqual(["/workspace/link", "/workspace/real"]);
  });

  it.each([
    ["configured first", ["folderRoot", "openedFile"] as const],
    ["opened first", ["openedFile", "folderRoot"] as const],
  ])(
    "keeps the configured origin when a configured root is also opened (%s)",
    (_, origins) => {
      const desired = mergeByRealpath(
        origins.map((origin) => candidate("/workspace/app", { origin })),
      );

      expect(desired).toHaveLength(1);
      expect(desired[0]?.origin).toBe("folderRoot");
    },
  );

  it("returns projects in first-seen order", () => {
    const desired = mergeByRealpath([
      candidate("/workspace/b"),
      candidate("/workspace/a"),
      candidate("/workspace/b-link", { realpathKey: "/workspace/b" }),
    ]);

    expect(desired.map((d) => d.root.fsPath)).toEqual([
      "/workspace/b",
      "/workspace/a",
    ]);
  });
});

describe("keepUnchanged", () => {
  it("reuses the current project object when its identity is unchanged", () => {
    const current = mergeByRealpath([candidate("/workspace/app")]).map((d) => ({
      ...d,
    }));
    const create = vi.fn((d: DesiredProject) => ({ ...d }));

    const next = keepUnchanged(
      current,
      mergeByRealpath([candidate("/workspace/app")]),
      create,
    );

    expect(next[0]).toBe(current[0]);
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a project when its aliases change", () => {
    const current = mergeByRealpath([candidate("/workspace/app")]).map((d) => ({
      ...d,
    }));
    const create = vi.fn((d: DesiredProject) => ({ ...d }));

    const next = keepUnchanged(
      current,
      mergeByRealpath([
        candidate("/workspace/app"),
        candidate("/workspace/app-link", { realpathKey: "/workspace/app" }),
      ]),
      create,
    );

    expect(next[0]).not.toBe(current[0]);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("sameOrder", () => {
  it("is true only for the same objects in the same order", () => {
    const a = { id: "a" };
    const b = { id: "b" };

    expect(sameOrder([a, b], [a, b])).toBe(true);
    expect(sameOrder([a, b], [b, a])).toBe(false);
    expect(sameOrder([a], [a, b])).toBe(false);
    expect(sameOrder([a], [{ id: "a" }])).toBe(false);
    expect(sameOrder([], [])).toBe(true);
  });
});

describe("lookupOrder", () => {
  it("puts deeper roots first", () => {
    const projects = [
      { root: uri("/workspace/app") },
      { root: uri("/workspace/app/models/nested") },
      { root: uri("/workspace/app/models") },
    ];

    expect(lookupOrder(projects).map((p) => p.root.fsPath)).toEqual([
      "/workspace/app/models/nested",
      "/workspace/app/models",
      "/workspace/app",
    ]);
  });

  it("breaks a depth tie by root path, descending", () => {
    const projects = [
      { root: uri("/workspace/a") },
      { root: uri("/workspace/b") },
    ];

    expect(lookupOrder(projects).map((p) => p.root.fsPath)).toEqual([
      "/workspace/b",
      "/workspace/a",
    ]);
  });

  it("does not reorder the input", () => {
    const projects = [{ root: uri("/a") }, { root: uri("/a/b") }];
    lookupOrder(projects);

    expect(projects.map((p) => p.root.fsPath)).toEqual(["/a", "/a/b"]);
  });
});
