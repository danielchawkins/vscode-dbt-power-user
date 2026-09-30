import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { commands, Disposable, ExtensionContext, window } from "vscode";
import {
  registerRuntimeTimings,
  RUNTIME_TIMINGS_COMMAND,
} from "../../benchmark/runtimeTimings";
import { DBTPowerUserExtension } from "../../dbtPowerUserExtension";
import { activate, deactivate } from "../../extension";
import {
  FUSION_CLIENT_STATES_COMMAND,
  registerFusionClientDiagnostics,
} from "../../fusion/fusionClientDiagnostics";
import { FusionClientPool } from "../../fusion/fusionClientPool";
import { ProjectRegistry } from "../../projects/projectRegistry";
import {
  CONNECTED_COLUMNS_COMMAND,
  PARENT_TABLES_COMMAND,
  registerConnectedColumnsCommand,
} from "../../services/connectedColumnsCommand";
import { DbtLineageService } from "../../services/dbtLineageService";
import { createMockLogOutputChannel } from "../mock/vscode";

const SWITCHES = ["FPU_RUNTIME_BENCHMARK", "FPU_INTEGRATION_COMMANDS"] as const;
const HARNESS_COMMANDS = [
  RUNTIME_TIMINGS_COMMAND,
  FUSION_CLIENT_STATES_COMMAND,
  CONNECTED_COLUMNS_COMMAND,
  PARENT_TABLES_COMMAND,
];

const registrations = new Map<string, { dispose: jest.Mock }>();

function enableHarness(on: boolean) {
  for (const name of SWITCHES) {
    if (on) {
      process.env[name] = "1";
    } else {
      delete process.env[name];
    }
  }
}

describe("disposable ownership", () => {
  const original = SWITCHES.map((name) => process.env[name]);
  const createOutputChannel = jest
    .mocked(window.createOutputChannel)
    .getMockImplementation();
  const createStatusBarItem = jest
    .mocked(window.createStatusBarItem)
    .getMockImplementation();

  beforeEach(() => {
    registrations.clear();
    (commands.registerCommand as jest.Mock).mockImplementation(
      (command: unknown) => {
        const registration = { dispose: jest.fn() };
        registrations.set(command as string, registration);
        return registration;
      },
    );
  });

  afterEach(() => {
    (commands.registerCommand as jest.Mock).mockReturnValue({
      dispose: jest.fn(),
    });
    jest
      .mocked(window.createOutputChannel)
      .mockImplementation(createOutputChannel!);
    jest
      .mocked(window.createStatusBarItem)
      .mockImplementation(createStatusBarItem!);
    SWITCHES.forEach((name, i) => {
      if (original[i] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = original[i];
      }
    });
  });

  it("harness helpers return nothing when their switch is off", () => {
    enableHarness(false);
    expect(registerRuntimeTimings()).toBeUndefined();
    expect(
      registerFusionClientDiagnostics(
        {} as ProjectRegistry,
        {} as FusionClientPool,
      ),
    ).toBeUndefined();
    expect(
      registerConnectedColumnsCommand({} as DbtLineageService),
    ).toBeUndefined();
  });

  it("harness helpers return a disposable that releases their commands", () => {
    enableHarness(true);
    const owned: (Disposable | undefined)[] = [
      registerRuntimeTimings(),
      registerFusionClientDiagnostics(
        {} as ProjectRegistry,
        {} as FusionClientPool,
      ),
      registerConnectedColumnsCommand({} as DbtLineageService),
    ];

    owned.forEach((disposable) => disposable?.dispose());

    for (const command of HARNESS_COMMANDS) {
      expect(registrations.get(command)?.dispose).toHaveBeenCalledTimes(1);
    }
  });

  it("only the extension enters context.subscriptions, and it releases the harness commands", async () => {
    enableHarness(true);
    const created: { dispose: jest.Mock }[] = [];
    const track = (item: object): never => {
      const tracked = { ...item, dispose: jest.fn() };
      created.push(tracked);
      return tracked as never;
    };
    jest
      .mocked(window.createOutputChannel)
      .mockImplementation(((name: string) =>
        track(createMockLogOutputChannel(name))) as never);
    jest
      .mocked(window.createStatusBarItem)
      .mockImplementation(() => track({ show: jest.fn(), hide: jest.fn() }));
    const context = {
      subscriptions: [] as { dispose(): unknown }[],
      workspaceState: { get: jest.fn(), update: jest.fn() },
      globalState: { get: jest.fn(), update: jest.fn() },
    } as unknown as ExtensionContext;

    const { ready } = activate(context);

    for (const command of HARNESS_COMMANDS) {
      expect(registrations.has(command)).toBe(true);
    }
    await ready;

    expect(context.subscriptions).toHaveLength(1);
    expect(context.subscriptions[0]).toBeInstanceOf(DBTPowerUserExtension);
    for (const command of HARNESS_COMMANDS) {
      expect(registrations.get(command)?.dispose).not.toHaveBeenCalled();
    }

    await deactivate();

    expect(context.subscriptions).toHaveLength(1);
    for (const command of HARNESS_COMMANDS) {
      expect(registrations.get(command)?.dispose).toHaveBeenCalledTimes(1);
    }
    expect(created.length).toBeGreaterThan(0);
    for (const item of created) {
      expect(item.dispose).toHaveBeenCalledTimes(1);
    }
  });
});
