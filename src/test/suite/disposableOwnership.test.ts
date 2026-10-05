import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import {
  commands,
  Disposable,
  ExtensionContext,
  languages,
  window,
} from "vscode";
import {
  registerRuntimeTimings,
  RUNTIME_TIMINGS_COMMAND,
} from "../../benchmark/runtimeTimings";
import { DBTPowerUserExtension } from "../../dbtPowerUserExtension";
import { activate, deactivate } from "../../extension";
import {
  CONNECTED_COLUMNS_COMMAND,
  PARENT_TABLES_COMMAND,
  registerConnectedColumnsCommand,
} from "../../features/lineage/connectedColumnsCommand";
import { DbtLineageService } from "../../features/lineage/dbtLineageService";
import {
  FUSION_CLIENT_STATES_COMMAND,
  registerFusionClientDiagnostics,
} from "../../projects/fusionClientDiagnostics";
import { FusionClientPool } from "../../projects/fusionClientPool";
import { ProjectRegistry } from "../../projects/projectRegistry";
import { createMockLogOutputChannel } from "../mock/vscode";

const SWITCHES = ["FPU_RUNTIME_BENCHMARK", "FPU_INTEGRATION_COMMANDS"] as const;
const HARNESS_COMMANDS = [
  RUNTIME_TIMINGS_COMMAND,
  FUSION_CLIENT_STATES_COMMAND,
  CONNECTED_COLUMNS_COMMAND,
  PARENT_TABLES_COMMAND,
];

const registrations = new Map<string, { dispose: Mock }>();

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
  const createOutputChannel = vi
    .mocked(window.createOutputChannel)
    .getMockImplementation();
  const createStatusBarItem = vi
    .mocked(window.createStatusBarItem)
    .getMockImplementation();
  const createLanguageStatusItem = vi
    .mocked(languages.createLanguageStatusItem)
    .getMockImplementation();

  beforeEach(() => {
    registrations.clear();
    (commands.registerCommand as Mock).mockImplementation(
      (command: unknown) => {
        const registration = { dispose: vi.fn() };
        registrations.set(command as string, registration);
        return registration;
      },
    );
  });

  afterEach(() => {
    (commands.registerCommand as Mock).mockReturnValue({
      dispose: vi.fn(),
    });
    vi.mocked(window.createOutputChannel).mockImplementation(
      createOutputChannel!,
    );
    vi.mocked(window.createStatusBarItem).mockImplementation(
      createStatusBarItem!,
    );
    vi.mocked(languages.createLanguageStatusItem).mockImplementation(
      createLanguageStatusItem!,
    );
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
    const created: { dispose: Mock }[] = [];
    const track = (item: object): never => {
      const tracked = { ...item, dispose: vi.fn() };
      created.push(tracked);
      return tracked as never;
    };
    vi.mocked(window.createOutputChannel).mockImplementation((name: string) =>
      track(createMockLogOutputChannel(name)),
    );
    vi.mocked(window.createStatusBarItem).mockImplementation(() =>
      track({ show: vi.fn(), hide: vi.fn() }),
    );
    vi.mocked(languages.createLanguageStatusItem).mockImplementation(
      (id, selector) => track({ id, selector }),
    );
    const context = {
      extension: { id: "danielchawkins.fusion-power-user" },
      subscriptions: [] as { dispose(): unknown }[],
      workspaceState: { get: vi.fn(), update: vi.fn() },
      globalState: { get: vi.fn(), update: vi.fn() },
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
