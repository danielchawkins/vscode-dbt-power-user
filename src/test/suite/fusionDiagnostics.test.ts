import { describe, expect, it, type Mock, vi } from "vitest";
import { Uri, workspace } from "vscode";
import {
  clearDiagnosticsOnDelete,
  ProjectDiagnosticsFilter,
} from "../../fusion/fusionDiagnostics";

describe("ProjectDiagnosticsFilter", () => {
  const present = new Set([
    "/p/models/a.sql",
    "/pp/models/a.sql",
    "/private/p/models/b.sql",
    "/elsewhere/a.sql",
  ]);
  const filter = () =>
    new ProjectDiagnosticsFilter(["/p", "/private/p"], (p) => present.has(p));

  it("drops diagnostics for files that do not exist", () => {
    expect(filter().shouldForward(Uri.file("/p/macros/adapters.sql"))).toBe(
      false,
    );
  });

  it("drops diagnostics for files outside the project root", () => {
    expect(filter().shouldForward(Uri.file("/elsewhere/a.sql"))).toBe(false);
  });

  it("accepts files under the canonical project root", () => {
    expect(filter().shouldForward(Uri.file("/private/p/models/b.sql"))).toBe(
      true,
    );
  });

  it("keeps forwarding a URI once forwarded, so a clear after deletion arrives", () => {
    const f = filter();
    expect(f.shouldForward(Uri.file("/p/models/a.sql"))).toBe(true);
    present.delete("/p/models/a.sql");
    expect(f.shouldForward(Uri.file("/p/models/a.sql"))).toBe(true);
    present.add("/p/models/a.sql");
  });

  it("forwards non-file URIs unchanged", () => {
    const untitled = {
      scheme: "untitled",
      fsPath: "Untitled-1",
      toString: () => "untitled:Untitled-1",
    };
    expect(filter().shouldForward(untitled as never)).toBe(true);
  });
});

describe("clearDiagnosticsOnDelete", () => {
  function watch(entries: string[]) {
    const onDelete: Array<(uri: Uri) => void> = [];
    const watcher = {
      onDidDelete: vi.fn((listener: (uri: Uri) => void) => {
        onDelete.push(listener);
        return { dispose: vi.fn() };
      }),
      dispose: vi.fn(),
    };
    (workspace.createFileSystemWatcher as Mock).mockReturnValueOnce(watcher);
    const uris = entries.map((entry) => Uri.file(entry));
    const collection = {
      forEach: vi.fn((cb: (uri: Uri) => void) => uris.forEach((u) => cb(u))),
      delete: vi.fn(),
    };
    const disposable = clearDiagnosticsOnDelete(
      Uri.file("/p"),
      () => collection as never,
    );
    return {
      collection,
      watcher,
      disposable,
      remove: (f: string) => onDelete[0](Uri.file(f)),
    };
  }

  it("watches only deletions of project files under the root", () => {
    watch([]);
    const { calls } = (workspace.createFileSystemWatcher as Mock).mock;
    expect(calls.at(-1)).toEqual([
      { base: Uri.file("/p"), pattern: "**/*" },
      true,
      true,
      false,
    ]);
  });

  it("removes a deleted file's diagnostics", () => {
    const { collection, remove } = watch([
      "/p/models/a.sql",
      "/p/models/b.sql",
    ]);
    remove("/p/models/a.sql");
    expect(collection.delete).toHaveBeenCalledWith(Uri.file("/p/models/a.sql"));
    expect(collection.delete).not.toHaveBeenCalledWith(
      Uri.file("/p/models/b.sql"),
    );
  });

  it("removes every entry under a deleted folder", () => {
    const { collection, remove } = watch([
      "/p/models/a.sql",
      "/p/models/sub/b.yml",
      "/p/modelsx/c.sql",
    ]);
    remove("/p/models");
    const deleted = collection.delete.mock.calls.map(
      ([uri]) => (uri as Uri).fsPath,
    );
    expect(deleted).toEqual(
      expect.arrayContaining(["/p/models/a.sql", "/p/models/sub/b.yml"]),
    );
    expect(deleted).not.toContain("/p/modelsx/c.sql");
  });

  it("disposes the watcher", () => {
    const { watcher, disposable } = watch([]);
    disposable.dispose();
    expect(watcher.dispose).toHaveBeenCalled();
  });
});
