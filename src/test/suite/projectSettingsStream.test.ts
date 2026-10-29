import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigurationChangeEvent, WorkspaceFolder } from "vscode";
import { Uri, workspace } from "vscode";
import {
  ProjectSettingsStream,
  type SnapshotStage,
} from "../../projects/project/projectSettingsStream";
import { CONFIGURATION_SECTION } from "../../settings";
import { flushAsync } from "../async";
import { declaredProject } from "../projectHarness";

/** The stages in the order the stream notifies them; the test checks the stream against this list. */
const SNAPSHOT_STAGES: readonly SnapshotStage[] = [
  "environment",
  "executable",
  "clients",
  "manifest",
  "features",
];

describe("ProjectSettingsStream", () => {
  const folder: WorkspaceFolder = {
    uri: Uri.file("/ws"),
    name: "ws",
    index: 0,
  };
  const a = declaredProject("a", "/ws/a", folder);
  const b = declaredProject("b", "/ws/b", folder);
  let listener: ((event: ConfigurationChangeEvent) => void) | undefined;
  let log: { error: ReturnType<typeof vi.fn> };
  let stream: ProjectSettingsStream;

  /** Fires a configuration change of `keys` for `root`, as VS Code does for a settings write. */
  function change(keys: string[], root?: Uri): void {
    listener?.({
      affectsConfiguration: (section: string, scope?: Uri) =>
        keys.some((key) => section === `${CONFIGURATION_SECTION}.${key}`) &&
        (scope === undefined || scope.fsPath === root?.fsPath),
    });
  }

  beforeEach(() => {
    listener = undefined;
    log = { error: vi.fn() };
    vi.spyOn(workspace, "onDidChangeConfiguration").mockImplementation((fn) => {
      listener = fn as (event: ConfigurationChangeEvent) => void;
      return { dispose: vi.fn() };
    });
    stream = new ProjectSettingsStream({ projects: [a, b] }, log as never);
  });

  afterEach(() => {
    stream.dispose();
    vi.restoreAllMocks();
  });

  it("notifies the stages in environment, executable, clients, manifest, features order", async () => {
    const order: string[] = [];
    for (const stage of SNAPSHOT_STAGES) {
      stream.onDidChangeSnapshot(stage, () => {
        order.push(stage);
      });
    }

    change(["target"], a.root);
    await flushAsync();

    expect(order).toEqual([
      "environment",
      "executable",
      "clients",
      "manifest",
      "features",
    ]);
  });

  it("awaits each stage's listeners before starting the next stage", async () => {
    const events: string[] = [];
    const slow = (label: string) => async () => {
      events.push(`${label}:start`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push(`${label}:end`);
    };
    stream.onDidChangeSnapshot("clients", slow("clients"));
    stream.onDidChangeSnapshot("clients", slow("clients-second"));
    stream.onDidChangeSnapshot("manifest", slow("manifest"));
    stream.onDidChangeSnapshot("executable", slow("executable"));

    change(["dbtPath"], a.root);
    for (let i = 0; i < 500 && events.length < 8; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(events).toEqual([
      "executable:start",
      "executable:end",
      "clients:start",
      "clients:end",
      "clients-second:start",
      "clients-second:end",
      "manifest:start",
      "manifest:end",
    ]);
  });

  it("notifies each stage once per change, and once per affected project", async () => {
    const calls = new Map<SnapshotStage, string[]>();
    for (const stage of SNAPSHOT_STAGES) {
      calls.set(stage, []);
      stream.onDidChangeSnapshot(stage, ({ project, changedFields }) => {
        const fields = changedFields.toSorted().join(",");
        calls.get(stage)!.push(`${project.name}:${fields}`);
      });
    }

    change(["target", "perProject"], a.root);
    await flushAsync();

    for (const stage of SNAPSHOT_STAGES) {
      expect(calls.get(stage)).toEqual(["a:perProject,target"]);
    }
  });

  it("notifies only the projects whose root the change affects", async () => {
    const seen: string[] = [];
    stream.onDidChangeSnapshot("manifest", ({ project }) => {
      seen.push(project.name);
    });

    change(["profilesDir"], b.root);
    await flushAsync();

    expect(seen).toEqual(["b"]);
  });

  it("triggers nothing for a key that is not project-scoped", async () => {
    const listenerFn = vi.fn();
    for (const stage of SNAPSHOT_STAGES) {
      stream.onDidChangeSnapshot(stage, listenerFn);
    }

    change(["lint.enabled"]);
    await flushAsync();

    expect(listenerFn).not.toHaveBeenCalled();
  });

  it("logs a failing stage and still runs the later stages", async () => {
    const features = vi.fn();
    stream.onDidChangeSnapshot("executable", () => {
      throw new Error("boom");
    });
    stream.onDidChangeSnapshot("features", features);

    change(["target"], a.root);
    await flushAsync();

    expect(log.error).toHaveBeenCalledTimes(1);
    expect(features).toHaveBeenCalledTimes(1);
  });

  it("stops notifying after dispose", async () => {
    const manifest = vi.fn();
    stream.onDidChangeSnapshot("manifest", manifest);
    stream.dispose();

    change(["target"], a.root);
    await flushAsync();

    expect(manifest).not.toHaveBeenCalled();
  });
});
