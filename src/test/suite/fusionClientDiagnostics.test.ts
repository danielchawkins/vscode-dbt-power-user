import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { commands, Uri } from "vscode";
import {
  FUSION_CLIENT_STATES_COMMAND,
  registerFusionClientDiagnostics,
} from "../../projects/fusionClientDiagnostics";
import { FusionClientPool } from "../../projects/fusionClientPool";
import {
  DeclaredProject,
  ProjectRegistry,
} from "../../projects/projectRegistry";

function project(name: string): DeclaredProject {
  return {
    root: Uri.file(`/workspace/${name}`),
    name,
    folder: { uri: Uri.file("/workspace"), name: "workspace", index: 0 },
    contains: () => true,
    dispose: vi.fn(),
  };
}

function commandHandler(): () => unknown {
  const registration = (commands.registerCommand as Mock).mock.calls.find(
    ([command]) => command === FUSION_CLIENT_STATES_COMMAND,
  );
  return registration?.[1] as () => unknown;
}

describe("registerFusionClientDiagnostics", () => {
  const originalHost = process.env.FPU_SMOKE_HOST;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalHost === undefined) {
      delete process.env.FPU_SMOKE_HOST;
    } else {
      process.env.FPU_SMOKE_HOST = originalHost;
    }
  });

  it.each([undefined, "", "other"])(
    "does not register when FPU_SMOKE_HOST is %j",
    (value) => {
      if (value === undefined) {
        delete process.env.FPU_SMOKE_HOST;
      } else {
        process.env.FPU_SMOKE_HOST = value;
      }

      registerFusionClientDiagnostics(
        { projects: [] } as unknown as ProjectRegistry,
        { get: vi.fn() } as unknown as FusionClientPool,
      );

      expect(commands.registerCommand).not.toHaveBeenCalled();
    },
  );

  it.each(["vscode", "cursor"])(
    "registers when FPU_SMOKE_HOST is %s",
    (host) => {
      process.env.FPU_SMOKE_HOST = host;

      registerFusionClientDiagnostics(
        { projects: [] } as unknown as ProjectRegistry,
        { get: vi.fn() } as unknown as FusionClientPool,
      );

      expect(commands.registerCommand).toHaveBeenCalledWith(
        FUSION_CLIENT_STATES_COMMAND,
        expect.any(Function),
      );
    },
  );

  it("maps registry projects to pool client state", () => {
    process.env.FPU_SMOKE_HOST = "vscode";
    const general = project("general");
    const sox = project("sox");
    const pool = {
      get: vi.fn((declared: DeclaredProject) =>
        declared === general
          ? { state: "running", failureReason: undefined }
          : undefined,
      ),
      getLaunch: vi.fn((declared: DeclaredProject) =>
        declared === general ? { target: "ci" } : undefined,
      ),
    } as unknown as FusionClientPool;

    registerFusionClientDiagnostics(
      { projects: [general, sox] } as unknown as ProjectRegistry,
      pool,
    );

    expect(commandHandler()()).toEqual([
      {
        projectName: "general",
        state: "running",
        failureReason: undefined,
        target: "ci",
      },
      {
        projectName: "sox",
        state: "stopped",
        failureReason: undefined,
        target: undefined,
      },
    ]);
  });

  it("registers when the integration harness asks for test commands", () => {
    delete process.env.FPU_SMOKE_HOST;
    process.env.FPU_INTEGRATION_COMMANDS = "1";
    try {
      registerFusionClientDiagnostics(
        { projects: [] } as unknown as ProjectRegistry,
        { get: vi.fn() } as unknown as FusionClientPool,
      );
    } finally {
      delete process.env.FPU_INTEGRATION_COMMANDS;
    }

    expect(commands.registerCommand).toHaveBeenCalledWith(
      FUSION_CLIENT_STATES_COMMAND,
      expect.any(Function),
    );
  });
});
