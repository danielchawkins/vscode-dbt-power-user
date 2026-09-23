import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { commands, ExtensionContext, Uri } from "vscode";
import {
  FUSION_CLIENT_STATES_COMMAND,
  registerFusionClientDiagnostics,
} from "../../lsp/fusionClientDiagnostics";
import { FusionClientPool } from "../../lsp/fusionClientPool";
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
    dispose: jest.fn(),
  };
}

function fakeContext(): jest.Mocked<ExtensionContext> {
  return { subscriptions: [] } as unknown as jest.Mocked<ExtensionContext>;
}

function commandHandler(): () => unknown {
  const registration = (commands.registerCommand as jest.Mock).mock.calls.find(
    ([command]) => command === FUSION_CLIENT_STATES_COMMAND,
  );
  return registration?.[1] as () => unknown;
}

describe("registerFusionClientDiagnostics", () => {
  const originalHost = process.env.FPU_SMOKE_HOST;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (originalHost === undefined) {
      delete process.env.FPU_SMOKE_HOST;
    } else {
      process.env.FPU_SMOKE_HOST = originalHost;
    }
  });

  it.each([undefined, "", "other"])(
    "does not register when FPU_SMOKE_HOST is %p",
    (value) => {
      if (value === undefined) {
        delete process.env.FPU_SMOKE_HOST;
      } else {
        process.env.FPU_SMOKE_HOST = value;
      }

      registerFusionClientDiagnostics(
        fakeContext(),
        { projects: [] } as unknown as ProjectRegistry,
        { get: jest.fn() } as unknown as FusionClientPool,
      );

      expect(commands.registerCommand).not.toHaveBeenCalled();
    },
  );

  it.each(["vscode", "cursor"])(
    "registers when FPU_SMOKE_HOST is %s",
    (host) => {
      process.env.FPU_SMOKE_HOST = host;

      registerFusionClientDiagnostics(
        fakeContext(),
        { projects: [] } as unknown as ProjectRegistry,
        { get: jest.fn() } as unknown as FusionClientPool,
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
      get: jest.fn((declared: DeclaredProject) =>
        declared === general
          ? { state: "running", failureReason: undefined }
          : undefined,
      ),
    } as unknown as FusionClientPool;

    registerFusionClientDiagnostics(
      fakeContext(),
      { projects: [general, sox] } as unknown as ProjectRegistry,
      pool,
    );

    expect(commandHandler()()).toEqual([
      { projectName: "general", state: "running", failureReason: undefined },
      { projectName: "sox", state: "stopped", failureReason: undefined },
    ]);
  });
});
