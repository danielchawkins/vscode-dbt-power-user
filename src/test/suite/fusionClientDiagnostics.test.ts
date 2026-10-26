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
} from "../../projects/clients/fusionClientDiagnostics";
import type { FusionClientPool } from "../../projects/clients/fusionClientPool";
import type { FusionStatus } from "../../projects/clients/fusionStatus";
import type { ProjectEnvironments } from "../../projects/clients/projectEnvironments";
import type {
  DeclaredProject,
  ProjectRegistry,
} from "../../projects/registry/projectRegistry";

function project(name: string): DeclaredProject {
  return {
    root: Uri.file(`/workspace/${name}`),
    name,
    folder: { uri: Uri.file("/workspace"), name: "workspace", index: 0 },
    origin: "explicit",
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

const noEnvironments = {
  peek: vi.fn(),
} as unknown as ProjectEnvironments;

const noStatus = {
  clientDetail: vi.fn(),
} as unknown as FusionStatus;

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

      registerFusionClientDiagnostics({
        registry: { projects: [] } as unknown as ProjectRegistry,
        pool: { get: vi.fn() } as unknown as FusionClientPool,
        environments: noEnvironments,
        status: noStatus,
      });

      expect(commands.registerCommand).not.toHaveBeenCalled();
    },
  );

  it.each(["vscode", "cursor"])(
    "registers when FPU_SMOKE_HOST is %s",
    (host) => {
      process.env.FPU_SMOKE_HOST = host;

      registerFusionClientDiagnostics({
        registry: { projects: [] } as unknown as ProjectRegistry,
        pool: { get: vi.fn() } as unknown as FusionClientPool,
        environments: noEnvironments,
        status: noStatus,
      });

      expect(commands.registerCommand).toHaveBeenCalledWith(
        FUSION_CLIENT_STATES_COMMAND,
        expect.any(Function),
      );
    },
  );

  it("maps registry projects to pool client state", () => {
    process.env.FPU_SMOKE_HOST = "vscode";
    const general = project("general");
    const sox = { ...project("sox"), origin: "openedFile" as const };
    const pool = {
      get: vi.fn((declared: DeclaredProject) =>
        declared === general
          ? {
              state: "running",
              failureReason: undefined,
              openDocuments: [Uri.file("/workspace/general/models/a.sql")],
            }
          : undefined,
      ),
      getLaunch: vi.fn((declared: DeclaredProject) =>
        declared === general ? { target: "ci" } : undefined,
      ),
    } as unknown as FusionClientPool;

    registerFusionClientDiagnostics({
      registry: { projects: [general, sox] } as unknown as ProjectRegistry,
      pool,
      environments: noEnvironments,
      status: noStatus,
    });

    expect(commandHandler()()).toEqual([
      {
        projectName: "general",
        projectRoot: general.root.fsPath,
        state: "running",
        failureReason: undefined,
        target: "ci",
        origin: "explicit",
        openDocuments: ["/workspace/general/models/a.sql"],
        compiles: 0,
        diagnosticCounts: {},
      },
      {
        projectName: "sox",
        projectRoot: sox.root.fsPath,
        state: "stopped",
        failureReason: undefined,
        target: undefined,
        origin: "openedFile",
        openDocuments: [],
        compiles: 0,
        diagnosticCounts: {},
      },
    ]);
  });

  it("reports completed compiles and diagnostic counts keyed by file path", () => {
    process.env.FPU_SMOKE_HOST = "vscode";
    const general = project("general");
    const model = Uri.file("/workspace/general/models/a.sql");
    const other = Uri.file("/workspace/general/models/b.sql");
    const diagnostics = {
      forEach: (callback: (uri: Uri, entries: unknown[]) => void) => {
        callback(model, [{}, {}]);
        callback(other, [{}]);
      },
    };
    const pool = {
      get: vi.fn(() => ({
        state: "running",
        failureReason: undefined,
        openDocuments: [],
        compiled: { completions: 2 },
        diagnostics,
      })),
      getLaunch: vi.fn(() => undefined),
    } as unknown as FusionClientPool;

    registerFusionClientDiagnostics({
      registry: { projects: [general] } as unknown as ProjectRegistry,
      pool,
      environments: noEnvironments,
      status: noStatus,
    });

    expect(commandHandler()()).toEqual([
      expect.objectContaining({
        projectName: "general",
        compiles: 2,
        diagnosticCounts: { [model.fsPath]: 2, [other.fsPath]: 1 },
      }),
    ]);
  });

  it("reports the environment source the project resolved", () => {
    process.env.FPU_SMOKE_HOST = "vscode";
    const general = project("general");
    const environments = {
      peek: vi.fn(() => ({ source: "mise" })),
    } as unknown as ProjectEnvironments;

    registerFusionClientDiagnostics({
      registry: { projects: [general] } as unknown as ProjectRegistry,
      pool: { get: vi.fn(), getLaunch: vi.fn() } as unknown as FusionClientPool,
      environments,
      status: noStatus,
    });

    expect(commandHandler()()).toEqual([
      expect.objectContaining({ environmentSource: "mise" }),
    ]);
    expect(environments.peek).toHaveBeenCalledWith(general);
  });

  it("reports the executable the client resolved to", () => {
    process.env.FPU_SMOKE_HOST = "vscode";
    const general = project("general");
    const pool = {
      get: vi.fn(),
      getLaunch: vi.fn(() => ({ resolvedPath: "/opt/mise/bin/dbt" })),
    } as unknown as FusionClientPool;

    registerFusionClientDiagnostics({
      registry: { projects: [general] } as unknown as ProjectRegistry,
      pool,
      environments: noEnvironments,
      status: noStatus,
    });

    expect(commandHandler()()).toEqual([
      expect.objectContaining({ executablePath: "/opt/mise/bin/dbt" }),
    ]);
  });

  it("reports the project directory the client was launched with", () => {
    process.env.FPU_SMOKE_HOST = "vscode";
    const general = project("general");
    const pool = {
      get: vi.fn(),
      getLaunch: vi.fn(() => ({ projectDir: "/workspace/general" })),
    } as unknown as FusionClientPool;

    registerFusionClientDiagnostics({
      registry: { projects: [general] } as unknown as ProjectRegistry,
      pool,
      environments: noEnvironments,
      status: noStatus,
    });

    expect(commandHandler()()).toEqual([
      expect.objectContaining({ projectDir: "/workspace/general" }),
    ]);
  });

  it("reports the client item's detail as the status detail", () => {
    process.env.FPU_SMOKE_HOST = "vscode";
    const general = project("general");
    const status = {
      clientDetail: vi.fn(() => "general · from mise"),
    } as unknown as FusionStatus;

    registerFusionClientDiagnostics({
      registry: { projects: [general] } as unknown as ProjectRegistry,
      pool: { get: vi.fn(), getLaunch: vi.fn() } as unknown as FusionClientPool,
      environments: noEnvironments,
      status,
    });

    expect(commandHandler()()).toEqual([
      expect.objectContaining({ statusDetail: "general · from mise" }),
    ]);
    expect(status.clientDetail).toHaveBeenCalledWith(general.root);
  });

  it("registers when the integration harness asks for test commands", () => {
    delete process.env.FPU_SMOKE_HOST;
    process.env.FPU_INTEGRATION_COMMANDS = "1";
    try {
      registerFusionClientDiagnostics({
        registry: { projects: [] } as unknown as ProjectRegistry,
        pool: { get: vi.fn() } as unknown as FusionClientPool,
        environments: noEnvironments,
        status: noStatus,
      });
    } finally {
      delete process.env.FPU_INTEGRATION_COMMANDS;
    }

    expect(commands.registerCommand).toHaveBeenCalledWith(
      FUSION_CLIENT_STATES_COMMAND,
      expect.any(Function),
    );
  });
});
