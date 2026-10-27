import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangeBurst } from "../../projects/manifest/manifestTrigger";
import { ParseScheduler } from "../../projects/manifest/parseScheduler";
import { silentLog } from "../testLog";

describe("ParseScheduler source-file parses", () => {
  const root = "/project";
  const model = path.join(root, "models", "a.sql");
  const other = path.join(root, "models", "b.sql");
  const added = path.join(root, "models", "c.sql");
  let files: Map<string, string>;
  let unreadable: Set<string>;
  let rebuildOnce: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let scheduler: ParseScheduler;

  const readFile = async (fsPath: string): Promise<Uint8Array> => {
    const text = files.get(fsPath);
    if (text === undefined || unreadable.has(fsPath)) {
      throw new Error(`ENOENT: ${fsPath}`);
    }
    return new TextEncoder().encode(text);
  };

  /** A burst whose first event arrived after the last parse ended. */
  async function laterBurst(...paths: string[]): Promise<ChangeBurst> {
    await vi.advanceTimersByTimeAsync(1);
    return { paths, firstEventAt: Date.now() };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    files = new Map([
      [model, "select 1"],
      [other, "select 2"],
    ]);
    unreadable = new Set();
    rebuildOnce = vi.fn(async () => {
      scheduler.markParsed();
    });
    scheduler = new ParseScheduler({
      log: silentLog(),
      root,
      rebuildOnce: () => rebuildOnce(),
      refreshConfig: async () => undefined,
      onSourceChanged: () => undefined,
      isDisposed: () => false,
      readFile,
    });
  });

  afterEach(() => {
    scheduler.dispose();
    vi.useRealTimers();
  });

  it("skips a byte-identical rewrite of a file the last parse read", async () => {
    await scheduler.sourceFileChanged({ paths: [model], firstEventAt: 1_000 });
    expect(rebuildOnce).toHaveBeenCalledTimes(1);
    await scheduler.sourceFileChanged(await laterBurst(model));
    expect(rebuildOnce).toHaveBeenCalledTimes(1);
  });

  it("parses when a recorded file changes by one byte", async () => {
    await scheduler.sourceFileChanged({ paths: [model], firstEventAt: 1_000 });
    files.set(model, "select 2");
    await scheduler.sourceFileChanged(await laterBurst(model));
    expect(rebuildOnce).toHaveBeenCalledTimes(2);
  });

  it("parses a path the last parse never recorded", async () => {
    await scheduler.sourceFileChanged({ paths: [model], firstEventAt: 1_000 });
    files.set(added, "select 3");
    await scheduler.sourceFileChanged(await laterBurst(added));
    expect(rebuildOnce).toHaveBeenCalledTimes(2);
  });

  it("parses a deleted path", async () => {
    await scheduler.sourceFileChanged({ paths: [model], firstEventAt: 1_000 });
    files.delete(model);
    await scheduler.sourceFileChanged(await laterBurst(model));
    expect(rebuildOnce).toHaveBeenCalledTimes(2);
  });

  it("parses a path that cannot be read", async () => {
    await scheduler.sourceFileChanged({ paths: [model], firstEventAt: 1_000 });
    unreadable.add(model);
    await scheduler.sourceFileChanged(await laterBurst(model));
    expect(rebuildOnce).toHaveBeenCalledTimes(2);
  });

  it("parses a burst that mixes an identical rewrite with a real change", async () => {
    await scheduler.sourceFileChanged({
      paths: [model, other],
      firstEventAt: 1_000,
    });
    files.set(other, "select 9");
    await scheduler.sourceFileChanged(await laterBurst(model, other));
    expect(rebuildOnce).toHaveBeenCalledTimes(2);
  });

  it("parses an identical rewrite whose burst began before the last parse ended", async () => {
    await scheduler.sourceFileChanged({ paths: [model], firstEventAt: 1_000 });
    await scheduler.sourceFileChanged({ paths: [model], firstEventAt: 1_000 });
    expect(rebuildOnce).toHaveBeenCalledTimes(2);
  });

  it("always parses after a project-file change, and forgets the records it replaces", async () => {
    await scheduler.sourceFileChanged({ paths: [model], firstEventAt: 1_000 });
    await scheduler.projectFileChanged();
    expect(rebuildOnce).toHaveBeenCalledTimes(2);
    await scheduler.sourceFileChanged(await laterBurst(model));
    expect(rebuildOnce).toHaveBeenCalledTimes(3);
  });

  it("forgets the records when a parse fails, so the next identical rewrite parses", async () => {
    await scheduler.sourceFileChanged({ paths: [model], firstEventAt: 1_000 });
    files.set(model, "select 2");
    rebuildOnce.mockRejectedValueOnce(new Error("dbt parse failed"));
    await expect(
      scheduler.sourceFileChanged(await laterBurst(model)),
    ).rejects.toThrow("dbt parse failed");
    files.set(model, "select 1");
    await scheduler.sourceFileChanged(await laterBurst(model));
    expect(rebuildOnce).toHaveBeenCalledTimes(3);
  });
});
