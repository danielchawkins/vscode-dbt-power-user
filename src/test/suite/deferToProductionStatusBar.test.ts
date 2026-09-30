import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { Uri, window, workspace } from "vscode";
import { DBTProject } from "../../dbt_client/dbtProject";
import { DeferToProductionStatusBar } from "../../statusbar/deferToProductionStatusBar";

describe("DeferToProductionStatusBar", () => {
  const root = Uri.file("/workspace/proj");
  let deferPerProject: Record<string, unknown>;
  let settingsListener: ((event: unknown) => void) | undefined;
  let statusBar: {
    text: string;
    show: jest.Mock;
    hide: jest.Mock;
    dispose: jest.Mock;
  };

  beforeEach(() => {
    deferPerProject = {};
    statusBar = {
      text: "",
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn(),
    };
    jest
      .spyOn(window, "createStatusBarItem")
      .mockReturnValue(statusBar as never);
    (workspace as any).workspaceFolders = [
      { uri: Uri.file("/workspace"), name: "workspace", index: 0 },
    ];
    (workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((key: string) =>
        key === "defer.perProject" ? deferPerProject : undefined,
      ),
      has: jest.fn(),
      update: jest.fn(),
    });
    jest.spyOn(workspace, "onDidChangeConfiguration").mockImplementation(((
      listener: (event: unknown) => void,
    ) => {
      settingsListener = listener;
      return { dispose: jest.fn() };
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (workspace as any).workspaceFolders = [];
  });

  it("reflects a defer settings change without applyDeferConfig", () => {
    const project = Object.create(DBTProject.prototype) as DBTProject;
    Object.assign(project, { projectRoot: root });
    const bar = new DeferToProductionStatusBar(
      { all: () => [project] } as never,
      { debug: jest.fn() } as never,
    );

    bar.updateStatusBar();
    expect(statusBar.text).toBe("$(sync-ignored) Defer");

    deferPerProject = { proj: { deferToProduction: true, favorState: false } };
    settingsListener?.({ affectsConfiguration: () => true });
    expect(statusBar.text).toBe("$(sync) Defer");

    bar.dispose();
  });
});
