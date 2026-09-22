import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { Uri, workspace, WorkspaceFolder } from "vscode";
import { LanguageClientOptions, State } from "vscode-languageclient/node";
import {
  fusionLogLevelArgument,
  parseTraceServerLevel,
} from "../../lsp/fusionClientSettings";
import {
  buildFusionLspArgs,
  commandPrefixForProject,
  DefaultFusionClientFactory,
  DISPOSAL_GRACE_MS,
  documentSelectorForProject,
  FUSION_LSP_COMMANDS,
  FusionClient,
  FusionClientState,
  fusionOutputChannelName,
  languageClientIdForProject,
  MAX_UNEXPECTED_EXIT_RETRIES,
  PARTIAL_LINE_LIMIT,
  prefixedCommand,
  ProcessStreamBuffer,
  SpawnedLspProcess,
  validateDocumentSelectorPatterns,
} from "../../lsp/fusionLanguageClient";
import {
  ExitingProcess,
  ReverseSocketServer,
  ReverseSocketStreams,
} from "../../lsp/reverseSocketTransport";
import { DeclaredProject } from "../../projects/projectRegistry";
import { createMockLogOutputChannel } from "../mock/vscode";

const folder: WorkspaceFolder = {
  uri: Uri.file("/workspace/general"),
  name: "general",
  index: 0,
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

function makeStreams(): ReverseSocketStreams {
  return {
    reader: new PassThrough(),
    writer: new PassThrough(),
  };
}

class FakeReverseSocketServer implements ReverseSocketServer {
  readonly port = 42_424;

  accept = jest.fn<(timeoutMs: number) => Promise<ReverseSocketStreams>>();
  dispose = jest.fn();

  constructor(private readonly streams: ReverseSocketStreams) {
    this.accept.mockResolvedValue(streams);
  }
}

class FakeExitingProcess extends EventEmitter implements ExitingProcess {
  private _exitCode: number | null = null;
  private _signalCode: NodeJS.Signals | null = null;
  kill = jest.fn((signal: NodeJS.Signals) => {
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
  it("builds args in the required order with optional launch flags", () => {
    const args = buildFusionLspArgs({
      port: 4242,
      projectRoot: "/workspace/general",
      commandPrefix: "fusionPowerUser:abc:",
      lintEnabled: false,
      staticAnalysisMode: "strict",
      traceServer: "verbose",
      profilesDir: "/profiles",
      target: "dev",
    });

    expect(args).toEqual([
      "lsp",
      "--socket",
      "4242",
      "--project-dir",
      "/workspace/general",
      "--lint-enabled",
      "false",
      "--static-analysis",
      "strict",
      "--no-version-check",
      "--command-prefix",
      "fusionPowerUser:abc:",
      "--profiles-dir",
      "/profiles",
      "--target",
      "dev",
      "--log-level",
      "trace",
    ]);
  });

  it("omits log level when traceServer is off", () => {
    const args = buildFusionLspArgs({
      port: 1,
      projectRoot: "/workspace/general",
      commandPrefix: "fusionPowerUser:abc:",
      lintEnabled: true,
      staticAnalysisMode: "baseline",
      traceServer: "off",
    });
    expect(args).not.toContain("--log-level");
    expect(fusionLogLevelArgument("off")).toBeUndefined();
    expect(fusionLogLevelArgument("messages")).toBe("debug");
    expect(fusionLogLevelArgument("verbose")).toBe("trace");
  });

  it("parses traceServer launch setting values", () => {
    expect(parseTraceServerLevel("verbose")).toBe("verbose");
    expect(parseTraceServerLevel("unexpected")).toBe("off");
  });

  it("names output channels with project name and root digest", () => {
    const general = makeProject("/workspace/general", "general");
    const duplicateName = makeProject("/workspace/sox", "general");

    expect(fusionOutputChannelName(general)).toContain("general");
    expect(fusionOutputChannelName(duplicateName)).toContain("general");
    expect(fusionOutputChannelName(general)).not.toBe(
      fusionOutputChannelName(duplicateName),
    );
  });

  it("uses configured static analysis mode, not effective mode", () => {
    const args = buildFusionLspArgs({
      port: 1,
      projectRoot: "/workspace/general",
      commandPrefix: "fusionPowerUser:abc:",
      lintEnabled: true,
      staticAnalysisMode: "off",
      traceServer: "off",
    });

    expect(args).toContain("off");
    expect(args).not.toContain("strict");
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
  let terminal: { warn: jest.Mock; error: jest.Mock; info: jest.Mock };

  beforeEach(() => {
    terminal = {
      warn: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
    };
    jest.spyOn(workspace, "getConfiguration").mockReturnValue({
      get: jest.fn((key: string) => {
        if (key === "staticAnalysisMode") {
          return "baseline";
        }
        if (key === "lintEnabled") {
          return true;
        }
        if (key === "traceServer") {
          return "off";
        }
        return undefined;
      }),
    } as any);
  });

  afterEach(async () => {
    jest.mocked(workspace.getConfiguration).mockRestore();
  });

  it("creates one output channel and passes it to LanguageClient", async () => {
    const streams = makeStreams();
    const server = new FakeReverseSocketServer(streams);
    const outputChannel = createMockLogOutputChannel(
      fusionOutputChannelName(makeProject()),
    );
    const createOutputChannel = jest.fn(
      (_name: string) => outputChannel,
    ) as NonNullable<
      ConstructorParameters<typeof DefaultFusionClientFactory>[1]
    >["createOutputChannel"];
    const createLanguageClient = jest.fn(
      async (
        _id: string,
        _name: string,
        _server: unknown,
        clientOptions: LanguageClientOptions,
      ) => {
        expect(clientOptions.outputChannel).toBe(outputChannel);
        expect(clientOptions).not.toHaveProperty("outputChannelName");
        return makeLanguageClient() as any;
      },
    );

    const factory = new DefaultFusionClientFactory(terminal as any, {
      listenForServer: async () => server,
      acceptWithProcessExit: async () => streams,
      spawnProcess: jest.fn(() => new FakeExitingProcess() as any),
      createLanguageClient,
      createOutputChannel,
      sleep: async () => {},
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
        env: {},
      },
      lintEnabled: true,
      commandPrefix: "fusionPowerUser:test:",
    });

    await flushAsync();
    expect(createOutputChannel).toHaveBeenCalledTimes(1);
    expect(createOutputChannel).toHaveBeenCalledWith(
      fusionOutputChannelName(makeProject()),
    );
    expect(client.outputChannel).toBe(outputChannel);

    await client.stop();
    expect(outputChannel.dispose).not.toHaveBeenCalled();
    client.dispose();
    await flushAsync();
    expect(outputChannel.dispose).toHaveBeenCalledTimes(1);
  });

  it("reuses the same output channel across restarts and retains failure logs", async () => {
    let listenAttempts = 0;
    const streams = makeStreams();
    const outputChannel = createMockLogOutputChannel(
      fusionOutputChannelName(makeProject()),
    );
    const channels: unknown[] = [];
    const createLanguageClient = jest.fn(
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

    const factory = new DefaultFusionClientFactory(terminal as any, {
      listenForServer: async () => {
        listenAttempts += 1;
        if (listenAttempts === 1) {
          throw new Error("listen failed");
        }
        return new FakeReverseSocketServer(streams);
      },
      acceptWithProcessExit: async () => streams,
      spawnProcess: jest.fn(() => new FakeExitingProcess() as any),
      createLanguageClient,
      createOutputChannel: jest.fn(
        (_name: string) => outputChannel,
      ) as NonNullable<
        ConstructorParameters<typeof DefaultFusionClientFactory>[1]
      >["createOutputChannel"],
      sleep: async () => {},
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
        env: {},
      },
      lintEnabled: true,
      commandPrefix: "fusionPowerUser:test:",
    });

    await waitForState(client, "failed");
    expect(outputChannel.appendLine).toHaveBeenCalledWith(
      expect.stringContaining("listen failed"),
    );

    await client.restart();
    await waitForState(client, "running");
    expect(channels).toHaveLength(1);
    expect(channels[0]).toBe(outputChannel);
    expect(outputChannel.appendLine).toHaveBeenCalledWith(
      expect.stringContaining("listen failed"),
    );

    await client.stop();
    client.dispose();
  });

  it("keeps effective static analysis unknown at the client seam", async () => {
    const streams = makeStreams();
    const server = new FakeReverseSocketServer(streams);
    const factory = new DefaultFusionClientFactory(terminal as any, {
      listenForServer: async () => server,
      acceptWithProcessExit: async () => streams,
      spawnProcess: jest.fn(() => new FakeExitingProcess() as any),
      createLanguageClient: async () => makeLanguageClient() as any,
      sleep: async () => {},
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
        env: {},
      },
      lintEnabled: true,
      commandPrefix: "fusionPowerUser:test:",
    });

    await waitForState(client, "running");
    expect(client.staticAnalysis.effective).toBe("unknown");
    expect(client.staticAnalysis.configured).toBe("baseline");

    await client.stop();
    client.dispose();
  });

  it("spawns directly without shell and passes executable env", async () => {
    const streams = makeStreams();
    const server = new FakeReverseSocketServer(streams);
    const processAdapter = new FakeExitingProcess();
    const spawnProcess = jest.fn(
      (_executable: string, _args: string[], _env: Record<string, string>) =>
        processAdapter as any,
    );
    const createLanguageClient = jest.fn(
      async () => makeLanguageClient() as any,
    );

    const factory = new DefaultFusionClientFactory(terminal as any, {
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
        version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
        env: { PATH: "/opt/bin", TEST_ENV: "1" },
      },
      lintEnabled: true,
      commandPrefix: "fusionPowerUser:test:",
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
      { PATH: "/opt/bin", TEST_ENV: "1" },
    );

    await client.stop();
    client.dispose();
  });

  it("uses options.lintEnabled in launch args", async () => {
    const streams = makeStreams();
    const server = new FakeReverseSocketServer(streams);
    const spawnProcess = jest.fn(() => new FakeExitingProcess() as any);

    const factory = new DefaultFusionClientFactory(terminal as any, {
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
        version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
        env: {},
      },
      lintEnabled: false,
      commandPrefix: "fusionPowerUser:test:",
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

  it("backs off on repeated process exits then fails", async () => {
    jest.useFakeTimers();
    const streams = makeStreams();
    const server = new FakeReverseSocketServer(streams);
    const processAdapter = new FakeExitingProcess();
    const spawnProcess = jest.fn(() => processAdapter as any);
    const sleeps: number[] = [];
    const languageClient = makeLanguageClient();
    const states: string[] = [];

    const factory = new DefaultFusionClientFactory(terminal as any, {
      listenForServer: async () => server,
      acceptWithProcessExit: async () => streams,
      spawnProcess,
      createLanguageClient: async () => languageClient as any,
      sleep: async (ms) => {
        sleeps.push(ms);
        await jest.advanceTimersByTimeAsync(ms);
      },
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
        env: {},
      },
      lintEnabled: true,
      commandPrefix: "fusionPowerUser:test:",
    });
    client.onDidChangeState((state) => states.push(state));

    await jest.runAllTimersAsync();
    await waitForState(client, "running");

    for (let attempt = 0; attempt < MAX_UNEXPECTED_EXIT_RETRIES; attempt += 1) {
      processAdapter.exit();
      await jest.runAllTimersAsync();
      await waitForState(client, "running");
    }

    processAdapter.exit();
    await jest.runAllTimersAsync();
    await waitForState(client, "failed");

    expect(states).toContain("failed");
    expect(spawnProcess.mock.calls.length).toBeGreaterThanOrEqual(
      1 + MAX_UNEXPECTED_EXIT_RETRIES,
    );
    expect(sleeps).toEqual([500, 1000, 2000]);

    await client.stop();
    await jest.runAllTimersAsync();
    client.dispose();
    jest.useRealTimers();
  });

  it("handles State.Stopped while running as unexpected stop", async () => {
    const streams = makeStreams();
    const server = new FakeReverseSocketServer(streams);
    const processAdapter = new FakeExitingProcess();
    const spawnProcess = jest.fn(() => processAdapter as any);
    const sleeps: number[] = [];
    const languageClient = makeLanguageClient();

    const factory = new DefaultFusionClientFactory(terminal as any, {
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
        version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
        env: {},
      },
      lintEnabled: true,
      commandPrefix: "fusionPowerUser:test:",
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
    const spawnProcess = jest.fn(() => processAdapter as any);
    const sleeps: number[] = [];
    const languageClient = makeLanguageClient();

    const factory = new DefaultFusionClientFactory(terminal as any, {
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
        version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
        env: {},
      },
      lintEnabled: true,
      commandPrefix: "fusionPowerUser:test:",
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
    const spawnProcess = jest.fn(() => processAdapter as any);
    const languageClient = makeLanguageClient();

    const factory = new DefaultFusionClientFactory(terminal as any, {
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
        version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
        env: {},
      },
      lintEnabled: true,
      commandPrefix: "fusionPowerUser:test:",
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
    const spawnProcess = jest.fn(() => processAdapter as any);
    let releaseBackoff = (): void => {};
    const backoffGate = new Promise<void>((resolve) => {
      releaseBackoff = resolve;
    });

    const factory = new DefaultFusionClientFactory(terminal as any, {
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
        version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
        env: {},
      },
      lintEnabled: true,
      commandPrefix: "fusionPowerUser:test:",
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
    const spawnProcess = jest.fn(() => processAdapter as any);
    const languageClient = makeLanguageClient();

    const factory = new DefaultFusionClientFactory(terminal as any, {
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
        version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
        env: {},
      },
      lintEnabled: true,
      commandPrefix: "fusionPowerUser:test:",
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
    const spawnProcess = jest.fn(
      (_executable: string, _args: string[], _env: Record<string, string>) =>
        new FakeExitingProcess() as any,
    );
    const factory = new DefaultFusionClientFactory(terminal as any, {
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
        version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
        env: {},
      },
      lintEnabled: true,
      commandPrefix: "fusionPowerUser:test:",
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
    const spawnProcess = jest.fn(() => {
      throw new Error("spawn failed");
    });

    const factory = new DefaultFusionClientFactory(terminal as any, {
      listenForServer: async () => server,
      spawnProcess,
      sleep: async () => {},
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
        env: {},
      },
      lintEnabled: true,
      commandPrefix: "fusionPowerUser:test:",
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
    const spawnProcess = jest.fn(() => processAdapter as any);
    const languageClient = makeLanguageClient();
    languageClient.start.mockRejectedValue(new Error("start failed"));

    const factory = new DefaultFusionClientFactory(terminal as any, {
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
        version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
        env: {},
      },
      lintEnabled: true,
      commandPrefix: "fusionPowerUser:test:",
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
    const spawnProcess = jest.fn(() => processAdapter as any);
    const languageClient = makeLanguageClient();

    const factory = new DefaultFusionClientFactory(terminal as any, {
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
        version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
        env: {},
      },
      lintEnabled: true,
      commandPrefix: "fusionPowerUser:test:",
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
    const outputChannel = createMockLogOutputChannel(
      fusionOutputChannelName(makeProject()),
    );
    const factory = new DefaultFusionClientFactory(terminal as any, {
      listenForServer: async () => {
        listenAttempts += 1;
        throw new Error(`listen failed ${listenAttempts}`);
      },
      createOutputChannel: (() => outputChannel) as NonNullable<
        ConstructorParameters<typeof DefaultFusionClientFactory>[1]
      >["createOutputChannel"],
      sleep: async () => {},
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
        env: {},
      },
      lintEnabled: true,
      commandPrefix: "fusionPowerUser:test:",
    });

    await waitForState(client, "failed");
    expect(client.failureReason).toContain("listen failed 1");

    await client.restart();
    await waitForState(client, "failed");
    expect(client.failureReason).toContain("listen failed 1");
    expect(outputChannel.appendLine).toHaveBeenCalledWith(
      expect.stringContaining("listen failed 2"),
    );

    await client.stop();
    client.dispose();
  });

  it("disposes with SIGTERM then SIGKILL after grace", async () => {
    const streams = makeStreams();
    const server = new FakeReverseSocketServer(streams);
    const processAdapter = new FakeExitingProcess();
    const spawnProcess = jest.fn(() => processAdapter as any);

    const factory = new DefaultFusionClientFactory(terminal as any, {
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
        version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
        env: {},
      },
      lintEnabled: true,
      commandPrefix: "fusionPowerUser:test:",
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

    const factory = new DefaultFusionClientFactory(terminal as any, {
      listenForServer: async () => server,
      acceptWithProcessExit: async () => streams,
      spawnProcess: jest.fn(() => new FakeExitingProcess() as any),
      createLanguageClient: async () => languageClient as any,
      sleep: async () => {},
    });

    const prefix = "fusionPowerUser:req:";
    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
        env: {},
      },
      lintEnabled: true,
      commandPrefix: prefix,
    });

    await flushAsync();
    await client.request(FUSION_LSP_COMMANDS.show, {
      uri: "file:///workspace/general/models/plain.sql",
    });

    expect(languageClient.sendRequest).toHaveBeenCalledWith(
      "workspace/executeCommand",
      {
        command: `${prefix}${FUSION_LSP_COMMANDS.show}`,
        arguments: [{ uri: "file:///workspace/general/models/plain.sql" }],
      },
      undefined,
    );

    await client.stop();
    client.dispose();
  });
});

function makeLanguageClient() {
  const stateEmitter = new EventEmitter();
  return {
    start: jest.fn(() => Promise.resolve()),
    stop: jest.fn(() => Promise.resolve()),
    sendRequest: jest.fn(
      (_type?: unknown, _param?: unknown, _token?: unknown) =>
        Promise.resolve(undefined),
    ),
    onDidChangeState: jest.fn(
      (listener: (event: { newState: State }) => void) => {
        stateEmitter.on("state", listener);
        return {
          dispose: () => stateEmitter.removeListener("state", listener),
        };
      },
    ),
    dispose: jest.fn(),
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
