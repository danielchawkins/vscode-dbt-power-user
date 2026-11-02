import { afterEach, describe, expect, it, vi } from "vitest";
import { Uri } from "vscode";
import { Project } from "../../projects/project/project";

import * as vscodeMock from "../mock/vscode";
import { createMockLogOutputChannel } from "../mock/vscode";
const vscodeMockAny = vscodeMock as Record<string, unknown>;
Object.assign(vscodeMockAny.env as Record<string, unknown>, {
  appName: "vscode-test",
  machineId: "test-machine",
  sessionId: "test-session",
});
const sharedWindow = vscodeMockAny.window as Record<string, unknown>;
sharedWindow.createStatusBarItem = vi.fn(() => ({
  text: "",
  tooltip: undefined,
  show: vi.fn(),
  hide: vi.fn(),
  dispose: vi.fn(),
}));
sharedWindow.createOutputChannel = vi.fn(
  (name?: string, _options?: { log?: boolean }) =>
    createMockLogOutputChannel(name),
);

import { compose } from "../../compositionRoot";
import { disposeAll } from "../../core/disposables";

function stubContext(workspaceValue?: string) {
  return {
    extension: { id: "danielchawkins.fusion-power-user" },
    extensionUri: { path: "/ext", fsPath: "/ext" },
    workspaceState: { get: vi.fn(() => workspaceValue), update: vi.fn() },
    globalState: { get: vi.fn(), update: vi.fn() },
  } as never;
}

describe("Fusion-only integration wiring", () => {
  const disposables: Array<{ dispose: () => void }> = [];

  afterEach(() => {
    disposeAll(disposables);
  });

  function composeTracked(workspaceValue?: string) {
    const composition = compose(stubContext(workspaceValue));
    disposables.push(composition.extension, composition.fusionStatus);
    return composition;
  }

  it("does not compose unsupported integrations", () => {
    expect(Object.keys(composeTracked()).sort()).toEqual([
      "extension",
      "extensionContextStore",
      "fusionExecutableResolver",
      "fusionOutputChannel",
      "fusionStatus",
      "projectFactory",
    ]);
  });

  it("gives a Project and its Fusion Clients one channel of the Declared Project", async () => {
    const createChannel = vi.mocked(
      sharedWindow.createOutputChannel as (name: string) => unknown,
    );
    const { projectFactory, fusionOutputChannel } = composeTracked();
    const declared = {
      root: Uri.file("/tmp/shared"),
      name: "shared",
      origin: "explicit" as const,
      folder: { uri: Uri.file("/tmp"), name: "tmp", index: 0 },
      contains: () => false,
      dispose: () => {},
    };
    createChannel.mockClear();

    const project = projectFactory(declared);
    const first = fusionOutputChannel(declared);
    const second = fusionOutputChannel(declared);
    first.info("from the client");

    const named = createChannel.mock.results
      .map(
        (result) =>
          result.value as ReturnType<typeof createMockLogOutputChannel>,
      )
      .filter((channel) => channel.name === "Fusion Power User: shared");
    expect(named).toHaveLength(1);
    expect(second).toBe(first);
    expect(named[0].info).toHaveBeenCalledWith("from the client");
    await project.dispose();
  });

  it("reads the extension context passed to each composition", () => {
    composeTracked("first");
    const { extensionContextStore } = composeTracked("rebound");
    expect(extensionContextStore.getFromWorkspaceState("key")).toBe("rebound");
  });

  it("builds a Project from the project factory", async () => {
    const project = composeTracked().projectFactory({
      root: Uri.file("/tmp/project"),
      name: "project",
      origin: "explicit",
      folder: { uri: Uri.file("/tmp"), name: "tmp", index: 0 },
      contains: () => false,
      dispose: () => {},
    });

    expect(project).toBeInstanceOf(Project);
    expect(() => project.getFusionCli()).toThrow(/not initialized/);
    await project.dispose();
  });
});
