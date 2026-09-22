import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import {
  commands,
  ExtensionContext,
  extensions,
  Uri,
  window,
  workspace,
} from "vscode";
import { DBTPowerUserExtension } from "../../dbtPowerUserExtension";

const UPSTREAM_EXTENSION = "innoverio.vscode-dbt-power-user";
const UNINSTALL_ACTION = "Uninstall Power User";

const activationHarness = (enabled: boolean) => {
  const detectDBT = jest.fn(() => Promise.resolve());
  const initializeDBTProjects = jest.fn(() => Promise.resolve());
  const initializeStatusBars = jest.fn(() => Promise.resolve());
  const registryInitialize = jest.fn(() => Promise.resolve());
  const fusionClientPoolInitialize = jest.fn();
  const fusionStatusInitialize = jest.fn();
  const extension = Object.create(DBTPowerUserExtension.prototype) as any;
  Object.assign(extension, {
    dbtProjectContainer: {
      setContext: jest.fn(),
      detectDBT,
      initializeDBTProjects,
    },
    projectRegistry: { initialize: registryInitialize },
    fusionClientPool: { initialize: fusionClientPoolInitialize },
    fusionStatus: { initialize: fusionStatusInitialize },
    projectContext: {},
    statusBars: { initialize: initializeStatusBars },
    dbtTerminal: { error: jest.fn() },
  });

  const folder = { uri: Uri.file("/workspace"), name: "workspace", index: 0 };
  (workspace as any).workspaceFolders = [folder];
  (workspace.getConfiguration as jest.Mock).mockReturnValue({
    get: jest.fn((key: string, fallback: unknown) =>
      key === "enabled" ? enabled : fallback,
    ),
  });

  const context = { subscriptions: [] } as unknown as ExtensionContext;
  return {
    context,
    detectDBT,
    extension,
    folder,
    initializeDBTProjects,
    initializeStatusBars,
    registryInitialize,
    fusionClientPoolInitialize,
    fusionStatusInitialize,
    dbtTerminal: extension.dbtTerminal,
  };
};

describe("DBTPowerUserExtension.activate", () => {
  let context: ExtensionContext | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    (extensions.getExtension as jest.Mock).mockReturnValue(undefined);
    (window.showErrorMessage as jest.Mock).mockReturnValue(Promise.resolve());
  });

  afterEach(() => {
    context?.subscriptions.forEach((disposable) => disposable.dispose());
    context = undefined;
  });

  it("offers to uninstall Power User and stops activation on conflict", async () => {
    const harness = activationHarness(true);
    context = harness.context;
    (extensions.getExtension as jest.Mock).mockReturnValue({
      id: UPSTREAM_EXTENSION,
    });
    (window.showErrorMessage as jest.Mock).mockReturnValue(
      Promise.resolve(UNINSTALL_ACTION),
    );

    await harness.extension.activate(context);

    expect(window.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("dbt Power User"),
      { modal: true },
      UNINSTALL_ACTION,
    );
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "workbench.extensions.uninstallExtension",
      UPSTREAM_EXTENSION,
    );
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.reloadWindow",
    );
    expect(harness.registryInitialize).not.toHaveBeenCalled();
    expect(harness.fusionClientPoolInitialize).not.toHaveBeenCalled();
    expect(harness.fusionStatusInitialize).not.toHaveBeenCalled();
    expect(harness.detectDBT).not.toHaveBeenCalled();
    expect(harness.initializeDBTProjects).not.toHaveBeenCalled();
    expect(harness.initializeStatusBars).not.toHaveBeenCalled();
    expect(harness.dbtTerminal.error).not.toHaveBeenCalled();
    expect(context.subscriptions).toHaveLength(0);
  });

  it("stops activation silently when disabled for the workspace folder", async () => {
    const harness = activationHarness(false);
    context = harness.context;

    await harness.extension.activate(context);

    expect(workspace.getConfiguration).toHaveBeenCalledWith(
      "dbt",
      harness.folder.uri,
    );
    expect(window.showErrorMessage).not.toHaveBeenCalled();
    expect(harness.registryInitialize).not.toHaveBeenCalled();
    expect(harness.fusionClientPoolInitialize).not.toHaveBeenCalled();
    expect(harness.fusionStatusInitialize).not.toHaveBeenCalled();
    expect(harness.detectDBT).not.toHaveBeenCalled();
    expect(harness.initializeDBTProjects).not.toHaveBeenCalled();
    expect(harness.initializeStatusBars).not.toHaveBeenCalled();
    expect(harness.dbtTerminal.error).not.toHaveBeenCalled();
    expect(context.subscriptions).toHaveLength(0);
  });

  it("activates when any workspace folder remains enabled", async () => {
    const harness = activationHarness(false);
    context = harness.context;
    const enabledFolder = {
      uri: Uri.file("/enabled"),
      name: "enabled",
      index: 1,
    };
    (workspace as any).workspaceFolders = [harness.folder, enabledFolder];
    (workspace.getConfiguration as jest.Mock).mockImplementation(
      (...args: unknown[]) => ({
        get: () => (args[1] as Uri).fsPath === enabledFolder.uri.fsPath,
      }),
    );

    await harness.extension.activate(context);

    expect(harness.registryInitialize).toHaveBeenCalledTimes(1);
    expect(harness.detectDBT).toHaveBeenCalledTimes(1);
    expect(harness.dbtTerminal.error).not.toHaveBeenCalled();
  });

  it("deactivate awaits pool stop before disposing collaborators", async () => {
    const order: string[] = [];
    const fusionClientPool = {
      initialize: jest.fn(),
      stop: jest.fn(async () => {
        order.push("pool.stop");
      }),
      dispose: jest.fn(() => {
        order.push("pool.dispose");
      }),
    };
    const disposable = { dispose: jest.fn(() => order.push("other.dispose")) };
    const extension = Object.create(
      DBTPowerUserExtension.prototype,
    ) as DBTPowerUserExtension;
    Object.assign(extension, {
      fusionClientPool,
      disposables: [disposable, fusionClientPool],
    });

    await extension.deactivate();

    expect(fusionClientPool.stop).toHaveBeenCalledTimes(1);
    expect(order.indexOf("pool.stop")).toBeLessThan(
      order.indexOf("other.dispose"),
    );
  });

  it("activates and initializes registry before detectDBT on happy path", async () => {
    const harness = activationHarness(true);
    context = harness.context;

    await harness.extension.activate(context);

    expect(harness.registryInitialize).toHaveBeenCalled();
    expect(harness.fusionClientPoolInitialize).toHaveBeenCalled();
    expect(harness.fusionStatusInitialize).toHaveBeenCalled();
    expect(harness.detectDBT).toHaveBeenCalled();
    expect(harness.initializeDBTProjects).toHaveBeenCalled();

    const registryCall = (harness.registryInitialize as jest.Mock).mock
      .invocationCallOrder[0];
    const poolCall = (harness.fusionClientPoolInitialize as jest.Mock).mock
      .invocationCallOrder[0];
    const statusCall = (harness.fusionStatusInitialize as jest.Mock).mock
      .invocationCallOrder[0];
    const detectCall = (harness.detectDBT as jest.Mock).mock
      .invocationCallOrder[0];
    expect(registryCall).toBeLessThan(poolCall);
    expect(poolCall).toBeLessThan(statusCall);
    expect(statusCall).toBeLessThan(detectCall);
    expect(registryCall).toBeLessThan(
      (harness.initializeDBTProjects as jest.Mock).mock.invocationCallOrder[0],
    );
    expect(harness.dbtTerminal.error).not.toHaveBeenCalled();
  });
});
