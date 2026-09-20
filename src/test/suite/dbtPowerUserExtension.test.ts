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
import {
  DBTPowerUserExtension,
  isPowerUserRejection,
} from "../../dbtPowerUserExtension";

const UPSTREAM_EXTENSION = "innoverio.vscode-dbt-power-user";
const UNINSTALL_ACTION = "Uninstall Power User";

const activationHarness = (enabled: boolean) => {
  const detectDBT = jest.fn(() => Promise.resolve());
  const initializeDBTProjects = jest.fn(() => Promise.resolve());
  const initializeStatusBars = jest.fn(() => Promise.resolve());
  const extension = Object.create(DBTPowerUserExtension.prototype) as any;
  Object.assign(extension, {
    dbtProjectContainer: {
      setContext: jest.fn(),
      initializeWalkthrough: jest.fn(),
      detectDBT,
      initializeDBTProjects,
    },
    whatsNewPanel: { checkAndShowOnActivation: jest.fn() },
    statusBars: { initialize: initializeStatusBars },
    altimateAuthService: { isAuthenticated: jest.fn(() => false) },
    altimateRequest: {
      setCreditsRemainingListener: jest.fn(),
      setExecutionsExhaustedListener: jest.fn(),
    },
    telemetry: {
      sendTelemetryEvent: jest.fn(),
      sendTelemetryError: jest.fn(),
    },
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
    telemetry: extension.telemetry,
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
    expect(harness.detectDBT).not.toHaveBeenCalled();
    expect(harness.initializeDBTProjects).not.toHaveBeenCalled();
    expect(harness.initializeStatusBars).not.toHaveBeenCalled();
    expect(harness.telemetry.sendTelemetryError).not.toHaveBeenCalled();
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
    expect(harness.detectDBT).not.toHaveBeenCalled();
    expect(harness.initializeDBTProjects).not.toHaveBeenCalled();
    expect(harness.initializeStatusBars).not.toHaveBeenCalled();
    expect(harness.telemetry.sendTelemetryError).not.toHaveBeenCalled();
    expect(context.subscriptions).toHaveLength(0);
  });

  it("activates when any workspace folder remains enabled", async () => {
    const harness = activationHarness(false);
    context = harness.context;
    const other = { uri: Uri.file("/dbt"), name: "dbt", index: 1 };
    (workspace as any).workspaceFolders = [harness.folder, other];
    (workspace.getConfiguration as jest.Mock).mockImplementation(
      (...args: unknown[]) => ({
        get: (key: string, fallback: unknown) =>
          key === "enabled"
            ? (args[1] as { fsPath: string }).fsPath === other.uri.fsPath
            : fallback,
      }),
    );

    await harness.extension.activate(context);

    expect(harness.detectDBT).toHaveBeenCalled();
    expect(harness.initializeDBTProjects).toHaveBeenCalled();
    expect(harness.telemetry.sendTelemetryError).not.toHaveBeenCalled();
  });

  it("runs detectDBT when there is no conflict and the folder is enabled", async () => {
    const harness = activationHarness(true);
    context = harness.context;

    await harness.extension.activate(context);

    expect(harness.detectDBT).toHaveBeenCalled();
    expect(harness.initializeDBTProjects).toHaveBeenCalled();
    expect(harness.telemetry.sendTelemetryError).not.toHaveBeenCalled();
  });
});

const errWithStack = (stack: string): Error => {
  const e = new Error("synthetic");
  e.stack = stack;
  return e;
};

describe("isPowerUserRejection", () => {
  describe("forwards rejections that originate in our extension", () => {
    it("Windows extension dir", () => {
      const stack = [
        "Error: Channel closed",
        "    at target.send (node:internal/child_process:753:16)",
        "    at C:\\Users\\u\\.vscode\\extensions\\innoverio.vscode-dbt-power-user-0.61.3-win32-x64\\dist\\extension.js:130:775419",
      ].join("\n");
      expect(isPowerUserRejection(errWithStack(stack))).toBe(true);
    });

    it("macOS / Linux extension dir", () => {
      const stack = [
        "Error: Python bridge is no longer connected.",
        "    at wrapper [as ex] (/Users/u/.vscode/extensions/innoverio.vscode-dbt-power-user-0.61.3-darwin-arm64/dist/extension.js:130:775520)",
      ].join("\n");
      expect(isPowerUserRejection(errWithStack(stack))).toBe(true);
    });

    it("our extension frame buried below node internals", () => {
      const stack = [
        "TypeError: terminated",
        "    at Fetch.onAborted (node:internal/deps/undici/undici:11322:53)",
        "    at Fetch.emit (node:events:519:28)",
        "    at /Users/u/.vscode/extensions/innoverio.vscode-dbt-power-user-0.61.3-darwin-arm64/dist/extension.js:130:775419",
      ].join("\n");
      expect(isPowerUserRejection(errWithStack(stack))).toBe(true);
    });
  });

  describe("drops rejections from other extensions", () => {
    it("GitLens cancellation", () => {
      const stack = [
        "CancellationError: Operation cancelled",
        "    at PromiseCache.getOrCreate (/Users/u/.vscode/extensions/eamodio.gitlens-17.12.2/dist/gitlens.js:1569:9092)",
        "    at BranchesGitSubProvider.getCurrentBranchReferenceCore (/Users/u/.vscode/extensions/eamodio.gitlens-17.12.2/dist/gitlens.js:2472:704)",
      ].join("\n");
      expect(isPowerUserRejection(errWithStack(stack))).toBe(false);
    });

    it("Ruff LSP client", () => {
      const stack = [
        "Error: Client is not running and can't be stopped. It's current state is: startFailed",
        "    at b.shutdown (/Users/u/.vscode/extensions/charliermarsh.ruff-2026.40.0-darwin-arm64/dist/extension.js:1:158836)",
      ].join("\n");
      expect(isPowerUserRejection(errWithStack(stack))).toBe(false);
    });

    it("SQLFluff parseVersion", () => {
      const stack = [
        "TypeError: Cannot read properties of undefined (reading 'match')",
        "    at Utilities.parseVersion (C:\\Users\\u\\.vscode\\extensions\\dorzey.vscode-sqlfluff-3.7.0\\out\\src\\extension.js:5:664)",
      ].join("\n");
      expect(isPowerUserRejection(errWithStack(stack))).toBe(false);
    });
  });

  describe("drops unattributable rejections", () => {
    it("null reason", () => {
      expect(isPowerUserRejection(null)).toBe(false);
    });

    it("undefined reason", () => {
      expect(isPowerUserRejection(undefined)).toBe(false);
    });

    it("string reason (no stack)", () => {
      expect(isPowerUserRejection("kaboom")).toBe(false);
    });

    it("plain object with no stack", () => {
      expect(isPowerUserRejection({ message: "no stack here" })).toBe(false);
    });

    it("Error with stack but no extension marker (VS Code core RPC)", () => {
      const stack = [
        "TypeError: Converting circular structure to JSON",
        "    at JSON.stringify (<anonymous>)",
        "    at GF (/Applications/Visual Studio Code.app/Contents/Resources/app/out/vs/code.js:407:149036)",
        "    at br.serializeRequestArguments (/Applications/Visual Studio Code.app/Contents/Resources/app/out/vs/code.js:407:158887)",
      ].join("\n");
      expect(isPowerUserRejection(errWithStack(stack))).toBe(false);
    });

    it("Error with non-string stack field", () => {
      const e = new Error("synthetic");
      (e as unknown as { stack: unknown }).stack = { not: "a string" };
      expect(isPowerUserRejection(e)).toBe(false);
    });
  });
});
