import * as path from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { ManifestTrigger } from "../../projects/manifest/manifestTrigger";
import {
  createdFileSystemWatchers,
  type MockFileSystemWatcher,
} from "../mock/vscode";
import { silentLog } from "../testLog";

/** Debounce applied to every watched file event before its handler runs. */
const MANIFEST_TRIGGER_DEBOUNCE_MS = 500;

describe("Project manifest trigger", () => {
  const root = "/project";
  let onProjectFileChanged: Mock<() => Promise<void>>;
  let onSourceFileChanged: Mock<() => Promise<void>>;
  let trigger: ManifestTrigger;
  let watcher: MockFileSystemWatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    createdFileSystemWatchers.length = 0;
    onProjectFileChanged = vi.fn(async () => undefined);
    onSourceFileChanged = vi.fn(async () => undefined);
    trigger = new ManifestTrigger(root, silentLog(), {
      sourcePaths: () => ["models", "macros", "seeds"],
      onProjectFileChanged,
      onSourceFileChanged,
    });
    trigger.start();
    expect(createdFileSystemWatchers).toHaveLength(1);
    watcher = createdFileSystemWatchers[0];
  });

  afterEach(() => {
    trigger.dispose();
    vi.useRealTimers();
  });

  it("watches source extensions under the project root", () => {
    expect(watcher.pattern).toEqual({
      base: root,
      pattern: "**/*.{sql,yml,yaml,csv}",
    });
  });

  it("rebuilds once after the debounce for model edits", async () => {
    watcher.fire("change", path.join(root, "models", "a.sql"));
    watcher.fire("create", path.join(root, "models", "b.sql"));
    watcher.fire("delete", path.join(root, "seeds", "c.csv"));
    await vi.advanceTimersByTimeAsync(MANIFEST_TRIGGER_DEBOUNCE_MS - 1);
    expect(onSourceFileChanged).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onSourceFileChanged).toHaveBeenCalledTimes(1);
    expect(onProjectFileChanged).not.toHaveBeenCalled();
  });

  it("ignores edits outside the model, macro and seed paths", async () => {
    watcher.fire("change", path.join(root, "target", "compiled", "a.sql"));
    watcher.fire("change", path.join(root, "models_old", "a.sql"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSourceFileChanged).not.toHaveBeenCalled();
  });

  it("refreshes config, then rebuilds, after a dbt_project.yml edit", async () => {
    watcher.fire("change", path.join(root, "dbt_project.yml"));
    await vi.advanceTimersByTimeAsync(MANIFEST_TRIGGER_DEBOUNCE_MS);
    expect(onProjectFileChanged).toHaveBeenCalledTimes(1);
    expect(onSourceFileChanged).not.toHaveBeenCalled();
  });

  it("drops a pending rebuild and stops watching on dispose", async () => {
    watcher.fire("change", path.join(root, "models", "a.sql"));
    trigger.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSourceFileChanged).not.toHaveBeenCalled();
    expect(watcher.dispose).toHaveBeenCalled();
    expect(watcher.listeners.change).toHaveLength(0);
  });
});
