import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { describe, expect, it, type Mock, vi } from "vitest";
import {
  type CancellationToken,
  Uri,
  workspace,
  WorkspaceFolder,
} from "vscode";
import {
  ExecuteCommandRequest,
  LanguageClientOptions,
  State,
} from "vscode-languageclient/node";
import { DBT_LSP_USE_TARGET_LSP, LspLaunch } from "../../core/lsp";
import { parseTraceServerLevel } from "../../core/project";
import { DbtLineageService } from "../../features/lineage/dbtLineageService";
import {
  clearDiagnosticsOnDelete,
  ProjectDiagnosticsFilter,
} from "../../fusion/fusionDiagnostics";
import {
  buildWorkspaceConfigurationResponse,
  canonicalProjectRoot,
  commandPrefixForProject,
  DefaultFusionClientFactory,
  DISPOSAL_GRACE_MS,
  documentSelectorForProject,
  FUSION_LSP_COMMANDS,
  FusionClient,
  FusionClientState,
  languageClientIdForProject,
  MAX_UNEXPECTED_EXIT_RETRIES,
  PARTIAL_LINE_LIMIT,
  prefixedCommand,
  ProcessStreamBuffer,
  SpawnedLspProcess,
  validateDocumentSelectorPatterns,
  withoutUnregisteredLspLenses,
} from "../../fusion/fusionLanguageClient";
import type { ChildProcess } from "../../fusion/process";
import {
  ExitingProcess,
  ReverseSocketServer,
  ReverseSocketStreams,
} from "../../fusion/reverseSocketTransport";
import { DeclaredProject } from "../../projects/projectRegistry";
import { createMockLogOutputChannel } from "../mock/vscode";

function channel() {
  return createMockLogOutputChannel("Fusion Power User: general");
}

const folder: WorkspaceFolder = {
  uri: Uri.file("/workspace/general"),
  name: "general",
  index: 0,
};

const cancellationToken: CancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => {} }),
};

function makeProject(
  rootPath = "/workspace/general",
  name = "general",
): DeclaredProject {
  return {
    root: Uri.file(rootPath),
    name,
    folder,
    contains: () => false,
    dispose: () => {},
  };
}

function makeLaunch(overrides: Partial<LspLaunch> = {}): LspLaunch {
  return {
    executable: { source: "path" },
    projectDir: "/workspace/general",
    target: undefined,
    profilesDir: undefined,
    staticAnalysis: "baseline",
    lintEnabled: true,
    logLevel: undefined,
    environment: {},
    ...overrides,
  };
}

function makeStreams(): ReverseSocketStreams {
  return {
    reader: new PassThrough(),
    writer: new PassThrough(),
  };
}

class FakeReverseSocketServer implements ReverseSocketServer {
  readonly port = 42_424;

  accept = vi.fn<(timeoutMs: number) => Promise<ReverseSocketStreams>>();
  dispose = vi.fn();

  constructor(streams: ReverseSocketStreams) {
    this.accept.mockResolvedValue(streams);
  }
}

class FakeExitingProcess extends EventEmitter implements ExitingProcess {
  private _exitCode: number | null = null;
  private _signalCode: NodeJS.Signals | null = null;
  kill = vi.fn((signal: NodeJS.Signals) => {
    this._signalCode = signal;
    this._exitCode = 0;
    this.emit("exit");
  });

  get exitCode(): number | null {
    return this._exitCode;
  }

  get signalCode(): NodeJS.Signals | null {
    return this._signalCode;
  }

  getStderr(): string {
    return "";
  }

  exit(): void {
    this._exitCode = 1;
    this.emit("exit");
  }
}

describe("fusionLanguageClient helpers", () => {
  it("parses traceServer launch setting values", () => {
    expect(parseTraceServerLevel("verbose")).toBe("verbose");
    expect(parseTraceServerLevel("unexpected")).toBe("off");
  });

  it("applies the same prefix for advertised commands and requests", () => {
    const prefix = commandPrefixForProject(makeProject());
    expect(prefix.endsWith(":")).toBe(true);
    expect(prefix.startsWith("fusionPowerUser:")).toBe(true);

    for (const command of Object.values(FUSION_LSP_COMMANDS)) {
      expect(prefixedCommand(prefix, command)).toBe(`${prefix}${command}`);
    }
  });

  it("derives a unique language client id from the project root digest", () => {
    const general = makeProject("/workspace/general");
    const sox = makeProject("/workspace/sox");
    const generalAgain = makeProject("/workspace/general");

    expect(languageClientIdForProject(general)).toMatch(/^fusion-lsp-/);
    expect(languageClientIdForProject(general)).toBe(
      languageClientIdForProject(generalAgain),
    );
    expect(languageClientIdForProject(general)).not.toBe(
      languageClientIdForProject(sox),
    );
  });

  it("uses string URI bases for protocol RelativePattern document selectors", () => {
    const root = Uri.file("/workspace/general");
    const selector = documentSelectorForProject(root);

    for (const filter of selector) {
      expect(filter.pattern.baseUri).toBe(root.toString());
      expect(filter.pattern.pattern).toBe("**/*");
    }
  });

  it("rejects Uri-object bases at validation", () => {
    expect(() =>
      validateDocumentSelectorPatterns([
        {
          language: "jinja-sql",
          pattern: {
            baseUri: Uri.file("/workspace/general") as unknown as string,
            pattern: "**/*",
          },
        },
      ]),
    ).toThrow(/baseUri must be a string URI/);
  });

  it("fails closed when a selector filter loses its pattern", () => {
    expect(() =>
      validateDocumentSelectorPatterns([
        { language: "jinja-sql", pattern: undefined as any },
      ]),
    ).toThrow(/missing pattern/);
  });

  it("fails closed when pattern string is empty", () => {
    expect(() =>
      validateDocumentSelectorPatterns([
        {
          language: "jinja-sql",
          pattern: { baseUri: "file:///x", pattern: "  " },
        },
      ]),
    ).toThrow(/pattern must be non-empty/);
  });

  it("caps overlong partial lines by preserving the head", () => {
    const buffer = new ProcessStreamBuffer();
    const lines: string[] = [];
    const onLine = (line: string): void => {
      lines.push(line);
    };

    buffer.feed("a".repeat(PARTIAL_LINE_LIMIT + 50), onLine);
    expect(lines).toHaveLength(0);
    buffer.flush(onLine);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveLength(PARTIAL_LINE_LIMIT);
    expect(lines[0]).toBe("a".repeat(PARTIAL_LINE_LIMIT));
  });

  it("builds workspace/configuration response for dbt section with linter", () => {
    expect(buildWorkspaceConfigurationResponse("dbt", true)).toEqual({
      lsp: { linter: { enabled: true } },
    });
    expect(buildWorkspaceConfigurationResponse("dbt", false)).toEqual({
      lsp: { linter: { enabled: false } },
    });
  });

  it("returns null for non-dbt sections", () => {
    expect(buildWorkspaceConfigurationResponse("python", true)).toBeNull();
    expect(buildWorkspaceConfigurationResponse("vscode", false)).toBeNull();
    expect(buildWorkspaceConfigurationResponse("", true)).toBeNull();
  });
});

describe("SpawnedLspProcess streams", () => {
  function makeChildProcess(): ChildProcess {
    const child = new EventEmitter() as ChildProcess;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = null;
    return child;
  }

  it("keeps stderr in getStderr when stdout is verbose", () => {
    const child = makeChildProcess();
    const channelLines: string[] = [];
    const adapter = new SpawnedLspProcess(child, (line) => {
      channelLines.push(line);
    });

    const stdout = child.stdout as PassThrough;
    const stderr = child.stderr as PassThrough;
    for (let i = 0; i < 200; i += 1) {
      stdout.write(`stdout line ${i}\n`);
    }
    stderr.write("fatal: connection refused\n");

    expect(adapter.getStderr()).toContain("fatal: connection refused");
    expect(
      channelLines.some((line) => line.includes("fatal: connection refused")),
    ).toBe(true);
    expect(channelLines.some((line) => line.startsWith("stdout line"))).toBe(
      true,
    );
  });

  it("flushes partial lines on close after late stdio chunks", () => {
    const child = makeChildProcess();
    const channelLines: string[] = [];
    const adapter = new SpawnedLspProcess(child, (line) => {
      channelLines.push(line);
    });

    const stderr = child.stderr as PassThrough;
    stderr.write("late error without newline");
    child.emit("close");

    expect(adapter.getStderr()).toContain("late error without newline");
    expect(channelLines).toContain("late error without newline");
  });
});

describe("FusionLanguageClient lifecycle", () => {
  it("passes the project's channel to LanguageClient and never disposes it", async () => {
    const streams = makeStreams();
    const server = new FakeReverseSocketServer(streams);
    const outputChannel = channel();
    const createLanguageClient = vi.fn(
      async (
        _id: string,
        _name: string,
        _server: unknown,
        clientOptions: LanguageClientOptions,
      ) => {
        expect(clientOptions.outputChannel).toBe(outputChannel);
        expect(clientOptions.traceOutputChannel).toBe(outputChannel);
        expect(clientOptions).not.toHaveProperty("outputChannelName");
        return makeLanguageClient() as any;
      },
    );

    const factory = new DefaultFusionClientFactory({
      listenForServer: async () => server,
      acceptWithProcessExit: async () => streams,
      spawnProcess: vi.fn(() => new FakeExitingProcess() as any),
      createLanguageClient,
      sleep: async () => {},
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
        env: {},
      },
      launch: makeLaunch(),
      commandPrefix: "fusionPowerUser:test:",
      outputChannel,
    });

    await flushAsync();
    expect(createLanguageClient).toHaveBeenCalledTimes(1);
    expect(client.outputChannel).toBe(outputChannel);

    await client.stop();
    client.dispose();
    await flushAsync();
    expect(outputChannel.dispose).not.toHaveBeenCalled();
  });

  it("forwards each compile-complete notification's error messages", async () => {
    const streams = makeStreams();
    const server = new FakeReverseSocketServer(streams);
    const handlers = new Map<string, (params: unknown) => void>();
    const languageClient = {
      ...makeLanguageClient(),
      onNotification: vi.fn(
        (method: string, handler: (params: unknown) => void) => {
          handlers.set(method, handler);
          return { dispose: vi.fn() };
        },
      ),
    };
    const onCompileErrors = vi.fn();
    const factory = new DefaultFusionClientFactory({
      listenForServer: async () => server,
      acceptWithProcessExit: async () => streams,
      spawnProcess: vi.fn(() => new FakeExitingProcess() as any),
      createLanguageClient: async () => languageClient as any,
      sleep: async () => {},
    });
    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
        env: {},
      },
      launch: makeLaunch(),
      commandPrefix: "fusionPowerUser:test:",
      outputChannel: channel(),
      onCompileErrors,
    });
    await flushAsync();

    expect([...handlers.keys()]).toEqual([
      "dbt/lspCompileComplete",
      "dbt/lspBackgroundCompileComplete",
    ]);
    handlers.get("dbt/lspCompileComplete")?.({
      errors: [
        { code: "1005", message: "bad env", severity: "Error" },
        { code: "9", message: "just a warning", severity: "Warning" },
      ],
    });
    handlers.get("dbt/lspBackgroundCompileComplete")?.({ errors: [] });
    expect(onCompileErrors.mock.calls).toEqual([[["bad env"]], [[]]]);

    await client.stop();
    client.dispose();
  });

  it("disposes the deleted-file watcher when the client stops", async () => {
    const streams = makeStreams();
    const watcher = {
      onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      dispose: vi.fn(),
    };
    (workspace.createFileSystemWatcher as Mock).mockReturnValueOnce(watcher);
    const factory = new DefaultFusionClientFactory({
      listenForServer: async () => new FakeReverseSocketServer(streams),
      acceptWithProcessExit: async () => streams,
      spawnProcess: vi.fn(() => new FakeExitingProcess() as any),
      createLanguageClient: async () => makeLanguageClient() as any,
      sleep: async () => {},
    });
    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
        env: {},
      },
      launch: makeLaunch(),
      commandPrefix: "fusionPowerUser:test:",
      outputChannel: channel(),
    });
    await waitForState(client, "running");
    expect(watcher.dispose).not.toHaveBeenCalled();

    await client.stop();
    expect(watcher.dispose).toHaveBeenCalledTimes(1);
  });

  it("reuses the same output channel across restarts and retains failure logs", async () => {
    let listenAttempts = 0;
    const streams = makeStreams();
    const outputChannel = channel();
    const channels: unknown[] = [];
    const createLanguageClient = vi.fn(
      async (
        _id: string,
        _name: string,
        _server: unknown,
        clientOptions: LanguageClientOptions,
      ) => {
        channels.push(clientOptions.outputChannel);
        return makeLanguageClient() as any;
      },
    );

    const factory = new DefaultFusionClientFactory({
      listenForServer: async () => {
        listenAttempts += 1;
        if (listenAttempts === 1) {
          throw new Error("listen failed");
        }
        return new FakeReverseSocketServer(streams);
      },
      acceptWithProcessExit: async () => streams,
      spawnProcess: vi.fn(() => new FakeExitingProcess() as any),
      createLanguageClient,
      sleep: async () => {},
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
        env: {},
      },
      launch: makeLaunch(),
      commandPrefix: "fusionPowerUser:test:",
      outputChannel,
    });

    await waitForState(client, "failed");
    expect(outputChannel.warn).toHaveBeenCalledWith(
      expect.stringContaining("listen failed"),
    );

    await client.restart();
    await waitForState(client, "running");
    expect(channels).toHaveLength(1);
    expect(channels[0]).toBe(outputChannel);
    expect(outputChannel.warn).toHaveBeenCalledWith(
      expect.stringContaining("listen failed"),
    );

    await client.stop();
    client.dispose();
  });

  it("reports the launch's static analysis mode at the client seam", async () => {
    const streams = makeStreams();
    const server = new FakeReverseSocketServer(streams);
    const factory = new DefaultFusionClientFactory({
      listenForServer: async () => server,
      acceptWithProcessExit: async () => streams,
      spawnProcess: vi.fn(() => new FakeExitingProcess() as any),
      createLanguageClient: async () => makeLanguageClient() as any,
      sleep: async () => {},
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
        env: {},
      },
      launch: makeLaunch(),
      commandPrefix: "fusionPowerUser:test:",
      outputChannel: channel(),
    });

    await waitForState(client, "running");
    expect(client.staticAnalysis).toBe("baseline");

    await client.stop();
    client.dispose();
  });

  it("spawns directly without shell and passes the launch environment", async () => {
    const streams = makeStreams();
    const server = new FakeReverseSocketServer(streams);
    const processAdapter = new FakeExitingProcess();
    const spawnProcess = vi.fn(
      (
        _executable: string,
        _args: string[],
        _env: Record<string, string>,
        _cwd?: string,
      ) => processAdapter as any,
    );
    const createLanguageClient = vi.fn(async () => makeLanguageClient() as any);

    const factory = new DefaultFusionClientFactory({
      listenForServer: async () => server,
      acceptWithProcessExit: async () => streams,
      spawnProcess,
      createLanguageClient,
      sleep: async () => {},
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
        env: { PROBE_ONLY: "1" },
      },
      launch: makeLaunch({
        environment: {
          PATH: "/opt/bin",
          TEST_ENV: "1",
          [DBT_LSP_USE_TARGET_LSP]: "1",
        },
      }),
      commandPrefix: "fusionPowerUser:test:",
      outputChannel: channel(),
    });

    await flushAsync();

    expect(spawnProcess).toHaveBeenCalledWith(
      "/opt/dbt",
      expect.arrayContaining([
        "lsp",
        "--socket",
        "42424",
        "--project-dir",
        "/workspace/general",
        "--lint-enabled",
        "true",
      ]),
      {
        PATH: "/opt/bin",
        TEST_ENV: "1",
        DBT_LSP_USE_TARGET_LSP: "1",
      },
      "/workspace/general",
    );

    await client.stop();
    client.dispose();
  });

  it("layers options.env over the launch environment, except DBT_LSP_USE_TARGET_LSP", async () => {
    const streams = makeStreams();
    const server = new FakeReverseSocketServer(streams);
    const spawnProcess = vi.fn(
      (
        _executable: string,
        _args: string[],
        _env: Record<string, string>,
        _cwd?: string,
      ) => new FakeExitingProcess() as any,
    );
    const factory = new DefaultFusionClientFactory({
      listenForServer: async () => server,
      acceptWithProcessExit: async () => streams,
      spawnProcess,
      createLanguageClient: async () => makeLanguageClient() as any,
      sleep: async () => {},
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
        env: {},
      },
      launch: makeLaunch({
        environment: {
          PATH: "/opt/bin",
          ORIGIN: "a",
          DBT_LSP_USE_TARGET_LSP: "1",
        },
      }),
      commandPrefix: "fusionPowerUser:test:",
      outputChannel: channel(),
      env: { ORIGIN: "b", DBT_LSP_USE_TARGET_LSP: "0" },
    });

    await flushAsync();

    expect(spawnProcess.mock.calls[0][2]).toEqual({
      PATH: "/opt/bin",
      ORIGIN: "b",
      DBT_LSP_USE_TARGET_LSP: "1",
    });

    await client.stop();
    client.dispose();
  });

  it("uses launch.lintEnabled in launch args", async () => {
    const streams = makeStreams();
    const server = new FakeReverseSocketServer(streams);
    const spawnProcess = vi.fn(() => new FakeExitingProcess() as any);

    const factory = new DefaultFusionClientFactory({
      listenForServer: async () => server,
      acceptWithProcessExit: async () => streams,
      spawnProcess,
      createLanguageClient: async () => makeLanguageClient() as any,
      sleep: async () => {},
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
        env: {},
      },
      launch: makeLaunch({ lintEnabled: false }),
      commandPrefix: "fusionPowerUser:test:",
      outputChannel: channel(),
    });

    await flushAsync();
    expect(spawnProcess).toHaveBeenCalled();
    const spawnArgs = spawnProcess.mock.calls[0] as unknown as [
      string,
      string[],
      Record<string, string>,
    ];
    expect(spawnArgs[1]).toEqual(
      expect.arrayContaining(["--lint-enabled", "false"]),
    );

    await client.stop();
    client.dispose();
  });

  it("configures workspace/configuration middleware for dbt section only", async () => {
    const streams = makeStreams();
    const server = new FakeReverseSocketServer(streams);
    let capturedClientOptions: LanguageClientOptions | undefined;

    const factory = new DefaultFusionClientFactory({
      listenForServer: async () => server,
      acceptWithProcessExit: async () => streams,
      spawnProcess: () => new FakeExitingProcess() as any,
      createLanguageClient: async (
        _id: string,
        _name: string,
        _serverOptions,
        clientOptions: LanguageClientOptions,
      ) => {
        capturedClientOptions = clientOptions;
        return makeLanguageClient() as any;
      },
      sleep: async () => {},
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
        env: {},
      },
      launch: makeLaunch(),
      commandPrefix: "fusionPowerUser:test:",
      outputChannel: channel(),
    });

    await flushAsync();

    expect(capturedClientOptions?.middleware).toBeDefined();
    const configMiddleware = (capturedClientOptions?.middleware as any)
      ?.workspace?.configuration;
    expect(configMiddleware).toBeDefined();
    const next = vi.fn();

    const result = await configMiddleware(
      { items: [{ section: "dbt" }, { section: "python" }] },
      cancellationToken,
      next,
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      lsp: { linter: { enabled: true } },
    });
    expect(result[1]).toBeNull();
    expect(next).not.toHaveBeenCalled();

    await client.stop();
    client.dispose();
  });

  it("middleware responds to launch.lintEnabled false", async () => {
    const streams = makeStreams();
    const server = new FakeReverseSocketServer(streams);
    let capturedClientOptions: LanguageClientOptions | undefined;

    const factory = new DefaultFusionClientFactory({
      listenForServer: async () => server,
      acceptWithProcessExit: async () => streams,
      spawnProcess: () => new FakeExitingProcess() as any,
      createLanguageClient: async (
        _id: string,
        _name: string,
        _serverOptions,
        clientOptions: LanguageClientOptions,
      ) => {
        capturedClientOptions = clientOptions;
        return makeLanguageClient() as any;
      },
      sleep: async () => {},
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
        env: {},
      },
      launch: makeLaunch({ lintEnabled: false }),
      commandPrefix: "fusionPowerUser:test:",
      outputChannel: channel(),
    });

    await flushAsync();

    const configMiddleware = (capturedClientOptions?.middleware as any)
      ?.workspace?.configuration;
    const next = vi.fn();
    const result = await configMiddleware(
      { items: [{ section: "dbt" }] },
      cancellationToken,
      next,
    );

    expect(result[0]).toEqual({
      lsp: { linter: { enabled: false } },
    });
    expect(next).not.toHaveBeenCalled();

    await client.stop();
    client.dispose();
  });

  it("backs off on repeated process exits then fails", async () => {
    vi.useFakeTimers();
    const streams = makeStreams();
    const server = new FakeReverseSocketServer(streams);
    const processAdapter = new FakeExitingProcess();
    const spawnProcess = vi.fn(() => processAdapter as any);
    const sleeps: number[] = [];
    const languageClient = makeLanguageClient();
    const states: string[] = [];

    const factory = new DefaultFusionClientFactory({
      listenForServer: async () => server,
      acceptWithProcessExit: async () => streams,
      spawnProcess,
      createLanguageClient: async () => languageClient as any,
      sleep: async (ms) => {
        sleeps.push(ms);
        await vi.advanceTimersByTimeAsync(ms);
      },
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
        env: {},
      },
      launch: makeLaunch(),
      commandPrefix: "fusionPowerUser:test:",
      outputChannel: channel(),
    });
    client.onDidChangeState((state) => states.push(state));

    await vi.runAllTimersAsync();
    await waitForState(client, "running");

    for (let attempt = 0; attempt < MAX_UNEXPECTED_EXIT_RETRIES; attempt += 1) {
      processAdapter.exit();
      await vi.runAllTimersAsync();
      await waitForState(client, "running");
    }

    processAdapter.exit();
    await vi.runAllTimersAsync();
    await waitForState(client, "failed");

    expect(states).toContain("failed");
    expect(spawnProcess.mock.calls.length).toBeGreaterThanOrEqual(
      1 + MAX_UNEXPECTED_EXIT_RETRIES,
    );
    expect(sleeps).toEqual([500, 1000, 2000]);

    await client.stop();
    await vi.runAllTimersAsync();
    client.dispose();
    vi.useRealTimers();
  });

  it("handles State.Stopped while running as unexpected stop", async () => {
    const streams = makeStreams();
    const server = new FakeReverseSocketServer(streams);
    const processAdapter = new FakeExitingProcess();
    const spawnProcess = vi.fn(() => processAdapter as any);
    const sleeps: number[] = [];
    const languageClient = makeLanguageClient();

    const factory = new DefaultFusionClientFactory({
      listenForServer: async () => server,
      acceptWithProcessExit: async () => streams,
      spawnProcess,
      createLanguageClient: async () => languageClient as any,
      sleep: async (ms) => {
        if (ms !== DISPOSAL_GRACE_MS) {
          sleeps.push(ms);
        }
      },
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
        env: {},
      },
      launch: makeLaunch(),
      commandPrefix: "fusionPowerUser:test:",
      outputChannel: channel(),
    });

    await waitForState(client, "running");
    expect(stateListenerFor(languageClient)).toBeDefined();
    stateListenerFor(languageClient)?.({ newState: State.Stopped });
    await waitForState(client, "restarting");
    await waitForState(client, "running");

    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([500]);

    await client.stop();
    client.dispose();
  });

  it("coalesces process exit and State.Stopped within one transport generation", async () => {
    const streams = makeStreams();
    const server = new FakeReverseSocketServer(streams);
    const processAdapter = new FakeExitingProcess();
    const spawnProcess = vi.fn(() => processAdapter as any);
    const sleeps: number[] = [];
    const languageClient = makeLanguageClient();

    const factory = new DefaultFusionClientFactory({
      listenForServer: async () => server,
      acceptWithProcessExit: async () => streams,
      spawnProcess,
      createLanguageClient: async () => languageClient as any,
      sleep: async (ms) => {
        if (ms !== DISPOSAL_GRACE_MS) {
          sleeps.push(ms);
        }
      },
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
        env: {},
      },
      launch: makeLaunch(),
      commandPrefix: "fusionPowerUser:test:",
      outputChannel: channel(),
    });

    await waitForState(client, "running");
    processAdapter.exit();
    stateListenerFor(languageClient)?.({ newState: State.Stopped });
    await waitForState(client, "restarting");
    await waitForState(client, "running");

    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([500]);

    await client.stop();
    client.dispose();
  });

  it("does not restart after stop() when unexpected signals arrive", async () => {
    const streams = makeStreams();
    const server = new FakeReverseSocketServer(streams);
    const processAdapter = new FakeExitingProcess();
    const spawnProcess = vi.fn(() => processAdapter as any);
    const languageClient = makeLanguageClient();

    const factory = new DefaultFusionClientFactory({
      listenForServer: async () => server,
      acceptWithProcessExit: async () => streams,
      spawnProcess,
      createLanguageClient: async () => languageClient as any,
      sleep: async () => {},
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
        env: {},
      },
      launch: makeLaunch(),
      commandPrefix: "fusionPowerUser:test:",
      outputChannel: channel(),
    });

    await waitForState(client, "running");
    await client.stop();
    processAdapter.exit();
    stateListenerFor(languageClient)?.({ newState: State.Stopped });
    await flushAsync();

    expect(spawnProcess).toHaveBeenCalledTimes(1);

    client.dispose();
  });

  it("does not spawn again when disposed during unexpected restart backoff", async () => {
    const streams = makeStreams();
    const server = new FakeReverseSocketServer(streams);
    const processAdapter = new FakeExitingProcess();
    const spawnProcess = vi.fn(() => processAdapter as any);
    let releaseBackoff = (): void => {};
    const backoffGate = new Promise<void>((resolve) => {
      releaseBackoff = resolve;
    });

    const factory = new DefaultFusionClientFactory({
      listenForServer: async () => server,
      acceptWithProcessExit: async () => streams,
      spawnProcess,
      createLanguageClient: async () => makeLanguageClient() as any,
      sleep: async (ms) => {
        if (ms === 500) {
          await backoffGate;
        }
      },
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
        env: {},
      },
      launch: makeLaunch(),
      commandPrefix: "fusionPowerUser:test:",
      outputChannel: channel(),
    });

    await waitForState(client, "running");
    processAdapter.exit();
    await waitForState(client, "restarting");

    client.dispose();
    releaseBackoff();
    await flushAsync();

    expect(spawnProcess).toHaveBeenCalledTimes(1);
  });

  it("resets unexpected exit budget on manual restart", async () => {
    const streams = makeStreams();
    const server = new FakeReverseSocketServer(streams);
    const processAdapter = new FakeExitingProcess();
    const spawnProcess = vi.fn(() => processAdapter as any);
    const languageClient = makeLanguageClient();

    const factory = new DefaultFusionClientFactory({
      listenForServer: async () => server,
      acceptWithProcessExit: async () => streams,
      spawnProcess,
      createLanguageClient: async () => languageClient as any,
      sleep: async () => {},
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
        env: {},
      },
      launch: makeLaunch(),
      commandPrefix: "fusionPowerUser:test:",
      outputChannel: channel(),
    });

    await waitForState(client, "running");
    processAdapter.exit();
    await waitForState(client, "restarting");
    await waitForState(client, "running");
    const spawnsAfterExit = spawnProcess.mock.calls.length;

    await client.restart();
    await waitForState(client, "running");
    processAdapter.exit();
    await waitForState(client, "restarting");
    await waitForState(client, "running");
    expect(spawnProcess.mock.calls.length).toBeGreaterThan(spawnsAfterExit + 1);

    await client.stop();
    client.dispose();
  });

  it("cleans up when listen fails", async () => {
    const spawnProcess = vi.fn(
      (_executable: string, _args: string[], _env: Record<string, string>) =>
        new FakeExitingProcess() as any,
    );
    const factory = new DefaultFusionClientFactory({
      listenForServer: async () => {
        throw new Error("listen failed");
      },
      spawnProcess,
      sleep: async () => {},
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
        env: {},
      },
      launch: makeLaunch(),
      commandPrefix: "fusionPowerUser:test:",
      outputChannel: channel(),
    });

    await flushAsync();
    expect(client.state).toBe("failed");
    expect(spawnProcess).not.toHaveBeenCalled();

    await client.stop();
    client.dispose();
  });

  it("cleans up socket and process when spawn fails", async () => {
    const streams = makeStreams();
    const server = new FakeReverseSocketServer(streams);
    const spawnProcess = vi.fn(() => {
      throw new Error("spawn failed");
    });

    const factory = new DefaultFusionClientFactory({
      listenForServer: async () => server,
      spawnProcess,
      sleep: async () => {},
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
        env: {},
      },
      launch: makeLaunch(),
      commandPrefix: "fusionPowerUser:test:",
      outputChannel: channel(),
    });

    await flushAsync();
    expect(server.dispose).toHaveBeenCalled();
    expect(client.state).toBe("failed");

    await client.stop();
    client.dispose();
  });

  it("cleans up when start fails after transport setup", async () => {
    const streams = makeStreams();
    const server = new FakeReverseSocketServer(streams);
    const processAdapter = new FakeExitingProcess();
    const spawnProcess = vi.fn(() => processAdapter as any);
    const languageClient = makeLanguageClient();
    languageClient.start.mockRejectedValue(new Error("start failed"));

    const factory = new DefaultFusionClientFactory({
      listenForServer: async () => server,
      acceptWithProcessExit: async () => streams,
      spawnProcess,
      createLanguageClient: async () => languageClient as any,
      sleep: async () => {},
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
        env: {},
      },
      launch: makeLaunch(),
      commandPrefix: "fusionPowerUser:test:",
      outputChannel: channel(),
    });

    await waitForState(client, "failed");
    expect(server.dispose).toHaveBeenCalled();
    expect(languageClient.stop).toHaveBeenCalled();
    expect(languageClient.dispose).toHaveBeenCalled();

    await client.stop();
    client.dispose();
  });

  it("serializes manual restart requests", async () => {
    const streams = makeStreams();
    const server = new FakeReverseSocketServer(streams);
    const processAdapter = new FakeExitingProcess();
    const spawnProcess = vi.fn(() => processAdapter as any);
    const languageClient = makeLanguageClient();

    const factory = new DefaultFusionClientFactory({
      listenForServer: async () => server,
      acceptWithProcessExit: async () => streams,
      spawnProcess,
      createLanguageClient: async () => languageClient as any,
      sleep: async () => {},
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
        env: {},
      },
      launch: makeLaunch(),
      commandPrefix: "fusionPowerUser:test:",
      outputChannel: channel(),
    });

    await flushAsync();
    const startsBefore = languageClient.start.mock.calls.length;

    await Promise.all([client.restart(), client.restart()]);
    await flushAsync();

    expect(languageClient.start.mock.calls.length).toBeGreaterThan(
      startsBefore,
    );

    await client.stop();
    client.dispose();
  });

  it("preserves the root failureReason when a later failure is logged", async () => {
    let listenAttempts = 0;
    const outputChannel = channel();
    const factory = new DefaultFusionClientFactory({
      listenForServer: async () => {
        listenAttempts += 1;
        throw new Error(`listen failed ${listenAttempts}`);
      },
      sleep: async () => {},
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
        env: {},
      },
      launch: makeLaunch(),
      commandPrefix: "fusionPowerUser:test:",
      outputChannel,
    });

    await waitForState(client, "failed");
    expect(client.failureReason).toContain("listen failed 1");

    await client.restart();
    await waitForState(client, "failed");
    expect(client.failureReason).toContain("listen failed 1");
    expect(outputChannel.warn).toHaveBeenCalledWith(
      expect.stringContaining("listen failed 2"),
    );

    await client.stop();
    client.dispose();
  });

  it("disposes with SIGTERM then SIGKILL after grace", async () => {
    const streams = makeStreams();
    const server = new FakeReverseSocketServer(streams);
    const processAdapter = new FakeExitingProcess();
    const spawnProcess = vi.fn(() => processAdapter as any);

    const factory = new DefaultFusionClientFactory({
      listenForServer: async () => server,
      acceptWithProcessExit: async () => streams,
      spawnProcess,
      createLanguageClient: async () => makeLanguageClient() as any,
      sleep: async () => {},
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
        env: {},
      },
      launch: makeLaunch(),
      commandPrefix: "fusionPowerUser:test:",
      outputChannel: channel(),
    });

    await flushAsync();
    await client.stop();

    expect(processAdapter.kill).toHaveBeenCalledWith("SIGTERM");
    expect(processAdapter.kill).not.toHaveBeenCalledWith("SIGKILL");
    client.dispose();
  });

  it("prefixes workspace/executeCommand requests", async () => {
    const streams = makeStreams();
    const server = new FakeReverseSocketServer(streams);
    const languageClient = makeLanguageClient();
    languageClient.sendRequest.mockResolvedValue({ ok: true } as never);

    const factory = new DefaultFusionClientFactory({
      listenForServer: async () => server,
      acceptWithProcessExit: async () => streams,
      spawnProcess: vi.fn(() => new FakeExitingProcess() as any),
      createLanguageClient: async () => languageClient as any,
      sleep: async () => {},
    });

    const prefix = "fusionPowerUser:req:";
    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
        env: {},
      },
      launch: makeLaunch(),
      commandPrefix: prefix,
      outputChannel: channel(),
    });

    await flushAsync();
    await client.request(FUSION_LSP_COMMANDS.show, {
      uri: "file:///workspace/general/models/plain.sql",
    });

    expect(languageClient.sendRequest).toHaveBeenCalledWith(
      ExecuteCommandRequest.type,
      {
        command: `${prefix}${FUSION_LSP_COMMANDS.show}`,
        arguments: [{ uri: "file:///workspace/general/models/plain.sql" }],
      },
      undefined,
    );

    await client.stop();
    client.dispose();
  });

  it("never has two listNodes requests in flight for concurrent upstream and downstream lineage", async () => {
    const streams = makeStreams();
    const languageClient = makeLanguageClient();
    let inFlight = 0;
    let peak = 0;
    let listNodes = 0;
    languageClient.sendRequest.mockImplementation((async (
      _type: unknown,
      param: unknown,
    ) => {
      if (!(param as { command: string }).command.endsWith("dbt.listNodes")) {
        return undefined;
      }
      const first = listNodes++ === 0;
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight--;
      if (first) {
        throw new Error("boom");
      }
      return { error: null, nodes: [] };
    }) as never);
    const client = new DefaultFusionClientFactory({
      listenForServer: async () => new FakeReverseSocketServer(streams),
      acceptWithProcessExit: async () => streams,
      spawnProcess: vi.fn(() => new FakeExitingProcess() as any),
      createLanguageClient: async () => languageClient as any,
      sleep: async () => {},
    }).create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
        env: {},
      },
      launch: makeLaunch(),
      commandPrefix: "fusionPowerUser:q:",
      outputChannel: channel(),
    });
    await waitForState(client, "running");
    const service = new DbtLineageService({} as any, () => client);

    const [upstream, downstream] = await Promise.all([
      service.getConnectedColumns({
        targets: [
          ["model.p.b", "total"],
          ["model.p.b", "n"],
        ],
        upstreamExpansion: false,
      }),
      service.getConnectedColumns({
        targets: [["model.p.b", "total"]],
        upstreamExpansion: true,
      }),
      client.request(FUSION_LSP_COMMANDS.show, {}),
    ]);

    expect(listNodes).toBe(3);
    expect(peak).toBe(1);
    expect(upstream).toEqual({
      kind: "lineage",
      columnLineage: [],
      failures: [{ target: ["model.p.b", "total"], message: "boom" }],
    });
    expect(downstream).toEqual({
      kind: "noLineage",
      reason: { kind: "staticAnalysis", mode: "baseline" },
    });

    await client.stop();
    client.dispose();
  });
});

function makeLanguageClient() {
  const stateEmitter = new EventEmitter();
  return {
    start: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    sendRequest: vi.fn((_type?: unknown, _param?: unknown, _token?: unknown) =>
      Promise.resolve(undefined),
    ),
    onDidChangeState: vi.fn(
      (listener: (event: { newState: State }) => void) => {
        stateEmitter.on("state", listener);
        return {
          dispose: () => stateEmitter.removeListener("state", listener),
        };
      },
    ),
    dispose: vi.fn(),
  };
}

function stateListenerFor(
  languageClient: ReturnType<typeof makeLanguageClient>,
): ((event: { newState: State }) => void) | undefined {
  const calls = languageClient.onDidChangeState.mock.calls;
  return calls[calls.length - 1]?.[0];
}

async function flushAsync(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

async function waitForState(
  client: FusionClient,
  target: FusionClientState | FusionClientState[],
): Promise<void> {
  const targets = Array.isArray(target) ? target : [target];
  if (targets.includes(client.state)) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.dispose();
      reject(
        new Error(
          `Timed out waiting for ${targets.join("|")}; got ${client.state}`,
        ),
      );
    }, 5_000);
    const sub = client.onDidChangeState((state) => {
      if (targets.includes(state)) {
        clearTimeout(timer);
        sub.dispose();
        resolve();
      }
    });
  });
}

describe("canonicalProjectRoot", () => {
  const fileUri = (fsPath: string) => Uri.file(fsPath);

  it("launches on the given root and installs no converters when it is already canonical", () => {
    expect(canonicalProjectRoot("/real/project", (p) => p)).toEqual({
      launchRoot: "/real/project",
    });
  });

  it("falls back to the given root when realpath fails", () => {
    const result = canonicalProjectRoot("/missing", () => {
      throw new Error("ENOENT");
    });
    expect(result).toEqual({ launchRoot: "/missing" });
  });

  it("maps document URIs between the symlinked root and its realpath", () => {
    const { launchRoot, uriConverters } = canonicalProjectRoot(
      "/link/project",
      () => "/real/project",
    );
    expect(launchRoot).toBe("/real/project");
    (Uri.parse as Mock).mockImplementation((value: unknown) =>
      Uri.file(String(value).replace(/^file:\/\//, "")),
    );

    expect(
      uriConverters!.code2Protocol(
        fileUri("/link/project/models/a.sql") as never,
      ),
    ).toBe("file:///real/project/models/a.sql");
    expect(
      uriConverters!.code2Protocol(
        fileUri("/link/project-other/a.sql") as never,
      ),
    ).toBe("file:///link/project-other/a.sql");
    expect(
      uriConverters!.protocol2Code("file:///real/project/models/a.sql").fsPath,
    ).toBe("/link/project/models/a.sql");
    expect(uriConverters!.protocol2Code("file:///elsewhere/a.sql").fsPath).toBe(
      "/elsewhere/a.sql",
    );
  });
});

describe("withoutUnregisteredLspLenses", () => {
  it("drops Fusion's dbt.previewCte lenses and keeps the rest", () => {
    const preview = {
      command: { command: "dbt.previewCte", title: "Preview CTE" },
    };
    const other = {
      command: { command: "fusionPowerUser.other", title: "Other" },
    };
    const unresolved = {};
    expect(withoutUnregisteredLspLenses([preview, other, unresolved])).toEqual([
      other,
      unresolved,
    ]);
    expect(withoutUnregisteredLspLenses(null)).toBeUndefined();
  });
});

describe("ProjectDiagnosticsFilter", () => {
  const present = new Set([
    "/p/models/a.sql",
    "/pp/models/a.sql",
    "/private/p/models/b.sql",
    "/elsewhere/a.sql",
  ]);
  const filter = () =>
    new ProjectDiagnosticsFilter(["/p", "/private/p"], (p) => present.has(p));

  it("forwards diagnostics for files that exist", () => {
    expect(filter().shouldForward(Uri.file("/p/models/a.sql"))).toBe(true);
  });

  it("drops diagnostics for files that do not exist", () => {
    expect(filter().shouldForward(Uri.file("/p/macros/adapters.sql"))).toBe(
      false,
    );
  });

  it("drops diagnostics for files outside the project root", () => {
    expect(filter().shouldForward(Uri.file("/elsewhere/a.sql"))).toBe(false);
  });

  it("drops diagnostics for a sibling whose path shares the root as a prefix", () => {
    expect(filter().shouldForward(Uri.file("/pp/models/a.sql"))).toBe(false);
  });

  it("accepts files under the canonical project root", () => {
    expect(filter().shouldForward(Uri.file("/private/p/models/b.sql"))).toBe(
      true,
    );
  });

  it("keeps forwarding a URI once forwarded, so a clear after deletion arrives", () => {
    const f = filter();
    expect(f.shouldForward(Uri.file("/p/models/a.sql"))).toBe(true);
    present.delete("/p/models/a.sql");
    expect(f.shouldForward(Uri.file("/p/models/a.sql"))).toBe(true);
    present.add("/p/models/a.sql");
  });

  it("forwards non-file URIs unchanged", () => {
    const untitled = {
      scheme: "untitled",
      fsPath: "Untitled-1",
      toString: () => "untitled:Untitled-1",
    };
    expect(filter().shouldForward(untitled as never)).toBe(true);
  });
});

describe("clearDiagnosticsOnDelete", () => {
  function watch(entries: string[]) {
    const onDelete: Array<(uri: Uri) => void> = [];
    const watcher = {
      onDidDelete: vi.fn((listener: (uri: Uri) => void) => {
        onDelete.push(listener);
        return { dispose: vi.fn() };
      }),
      dispose: vi.fn(),
    };
    (workspace.createFileSystemWatcher as Mock).mockReturnValueOnce(watcher);
    const uris = entries.map((entry) => Uri.file(entry));
    const collection = {
      forEach: vi.fn((cb: (uri: Uri) => void) => uris.forEach((u) => cb(u))),
      delete: vi.fn(),
    };
    const disposable = clearDiagnosticsOnDelete(
      Uri.file("/p"),
      () => collection as never,
    );
    return {
      collection,
      watcher,
      disposable,
      remove: (f: string) => onDelete[0](Uri.file(f)),
    };
  }

  it("watches only deletions of project files under the root", () => {
    watch([]);
    const { calls } = (workspace.createFileSystemWatcher as Mock).mock;
    expect(calls[calls.length - 1]).toEqual([
      { base: Uri.file("/p"), pattern: "**/*" },
      true,
      true,
      false,
    ]);
  });

  it("removes a deleted file's diagnostics", () => {
    const { collection, remove } = watch([
      "/p/models/a.sql",
      "/p/models/b.sql",
    ]);
    remove("/p/models/a.sql");
    expect(collection.delete).toHaveBeenCalledWith(Uri.file("/p/models/a.sql"));
    expect(collection.delete).not.toHaveBeenCalledWith(
      Uri.file("/p/models/b.sql"),
    );
  });

  it("removes every entry under a deleted folder", () => {
    const { collection, remove } = watch([
      "/p/models/a.sql",
      "/p/models/sub/b.yml",
      "/p/modelsx/c.sql",
    ]);
    remove("/p/models");
    const deleted = collection.delete.mock.calls.map(
      ([uri]) => (uri as Uri).fsPath,
    );
    expect(deleted).toEqual(
      expect.arrayContaining(["/p/models/a.sql", "/p/models/sub/b.yml"]),
    );
    expect(deleted).not.toContain("/p/modelsx/c.sql");
  });

  it("disposes the watcher", () => {
    const { watcher, disposable } = watch([]);
    disposable.dispose();
    expect(watcher.dispose).toHaveBeenCalled();
  });
});
