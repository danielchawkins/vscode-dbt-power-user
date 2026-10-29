import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { Uri, window, workspace } from "vscode";
import { DeferToProductionStatusBar } from "../../features/defer/deferToProductionStatusBar";
import { Project } from "../../projects/project/project";
import { ProjectSettingsStream } from "../../projects/project/projectSettingsStream";

describe("DeferToProductionStatusBar", () => {
  const root = Uri.file("/workspace/proj");
  let deferPerProject: Record<string, unknown>;
  let settingsListener: ((event: unknown) => void) | undefined;
  let statusBar: {
    text: string;
    show: Mock;
    hide: Mock;
    dispose: Mock;
  };

  beforeEach(() => {
    deferPerProject = {};
    statusBar = {
      text: "",
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
    };
    vi.spyOn(window, "createStatusBarItem").mockReturnValue(statusBar as never);
    (workspace as any).workspaceFolders = [
      { uri: Uri.file("/workspace"), name: "workspace", index: 0 },
    ];
    (workspace.getConfiguration as Mock).mockReturnValue({
      get: vi.fn((key: string) =>
        key === "defer.perProject" ? deferPerProject : undefined,
      ),
      has: vi.fn(),
      update: vi.fn(),
    });
    vi.spyOn(workspace, "onDidChangeConfiguration").mockImplementation(((
      listener: (event: unknown) => void,
    ) => {
      settingsListener = listener;
      return { dispose: vi.fn() };
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (workspace as any).workspaceFolders = [];
  });

  it("reflects a defer settings change without applyDeferConfig", async () => {
    const project = Object.create(Project.prototype) as Project;
    Object.assign(project, { root: root });
    const log = { debug: vi.fn(), error: vi.fn() } as never;
    const settings = new ProjectSettingsStream(
      { projects: [{ root }] as never },
      log,
    );
    const bar = new DeferToProductionStatusBar(
      { all: () => [project] } as never,
      log,
      settings,
    );

    bar.updateStatusBar();
    expect(statusBar.text).toBe("$(sync-ignored) Defer");

    deferPerProject = { proj: { deferToProduction: true, favorState: false } };
    settingsListener?.({ affectsConfiguration: () => true });
    await new Promise((resolve) => setImmediate(resolve));
    expect(statusBar.text).toBe("$(sync) Defer");

    bar.dispose();
    settings.dispose();
  });
});
