import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, type Mock, vi } from "vitest";
import {
  type CancellationToken,
  CancellationTokenSource,
  Uri,
  workspace,
} from "vscode";
import type { LanguageClientOptions } from "vscode-languageclient/node";
import { ExecuteCommandRequest, State } from "vscode-languageclient/node";
import { URI as VsCodeUri } from "vscode-uri";
import { DbtLineageService } from "../../features/lineage/dbtLineageService";
import {
  DISPOSAL_GRACE_MS,
  FUSION_LSP_COMMANDS,
  MAX_UNEXPECTED_EXIT_RETRIES,
} from "../../fusion/fusionClient";
import { createFusionCommands } from "../../fusion/fusionCommands";
import { flushAsync } from "../async";
import {
  channel,
  FakeReverseSocketServer,
  makeLaunch,
  makeLanguageClient,
  makeProject,
  makeStreams,
  startClient,
  stateListenerFor,
  waitForState,
} from "../fusionClientHarness";

const cancellationToken: CancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => {} }),
};

describe("FusionLanguageClient lifecycle", () => {
  it("passes the project's channel to LanguageClient and never disposes it", async () => {
    const outputChannel = channel();
    const { client, createLanguageClient } = startClient({
      options: { outputChannel },
    });

    await flushAsync();
    expect(createLanguageClient).toHaveBeenCalledTimes(1);
    const clientOptions = createLanguageClient.mock.calls[0]?.[3] as
      | LanguageClientOptions
      | undefined;
    expect(clientOptions?.outputChannel).toBe(outputChannel);
    expect(clientOptions?.traceOutputChannel).toBe(outputChannel);
    expect(clientOptions).not.toHaveProperty("outputChannelName");
    expect(client.outputChannel).toBe(outputChannel);

    await client.stop();
    client.dispose();
    await flushAsync();
    expect(outputChannel.dispose).not.toHaveBeenCalled();
  });

  it("forwards each compile-complete notification's error messages", async () => {
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
    const { client } = startClient({
      languageClient,
      options: { onCompileErrors },
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
    const watcher = {
      onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      dispose: vi.fn(),
    };
    (workspace.createFileSystemWatcher as Mock).mockReturnValueOnce(watcher);
    const { client } = startClient();
    await waitForState(client, "running");
    expect(watcher.dispose).not.toHaveBeenCalled();

    await client.stop();
    expect(watcher.dispose).toHaveBeenCalledTimes(1);
  });

  it("reuses the same output channel across restarts and retains failure logs", async () => {
    let listenAttempts = 0;
    const streams = makeStreams();
    const outputChannel = channel();

    const { client, createLanguageClient } = startClient({
      options: { outputChannel },
      deps: {
        listenForServer: async () => {
          listenAttempts += 1;
          if (listenAttempts === 1) {
            throw new Error("listen failed");
          }
          return new FakeReverseSocketServer(streams);
        },
      },
    });

    await waitForState(client, "failed");
    expect(outputChannel.warn).toHaveBeenCalledWith(
      expect.stringContaining("listen failed"),
    );

    await client.restart();
    await waitForState(client, "running");
    const channels = createLanguageClient.mock.calls.map(
      (call) => (call[3] as LanguageClientOptions).outputChannel,
    );
    expect(channels).toHaveLength(1);
    expect(channels[0]).toBe(outputChannel);
    expect(outputChannel.warn).toHaveBeenCalledWith(
      expect.stringContaining("listen failed"),
    );

    await client.stop();
    client.dispose();
  });

  it("reports the launch's static analysis mode at the client seam", async () => {
    const { client } = startClient();

    await waitForState(client, "running");
    expect(client.staticAnalysis).toBe("baseline");

    await client.stop();
    client.dispose();
  });

  it("configures workspace/configuration middleware for dbt section only", async () => {
    const { client, createLanguageClient } = startClient();

    await flushAsync();

    const capturedClientOptions = createLanguageClient.mock.calls[0]?.[3] as
      | LanguageClientOptions
      | undefined;
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
    const { client, createLanguageClient } = startClient({
      options: { launch: makeLaunch({ lintEnabled: false }) },
    });

    await flushAsync();

    const capturedClientOptions = createLanguageClient.mock.calls[0]?.[3] as
      | LanguageClientOptions
      | undefined;
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
    const sleeps: number[] = [];
    const states: string[] = [];

    const { client, processAdapter, spawnProcess } = startClient({
      deps: {
        sleep: async (ms) => {
          sleeps.push(ms);
          await vi.advanceTimersByTimeAsync(ms);
        },
      },
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
    const sleeps: number[] = [];
    const { client, languageClient, spawnProcess } = startClient({
      deps: {
        sleep: async (ms) => {
          if (ms !== DISPOSAL_GRACE_MS) {
            sleeps.push(ms);
          }
        },
      },
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
    const sleeps: number[] = [];
    const { client, processAdapter, languageClient, spawnProcess } =
      startClient({
        deps: {
          sleep: async (ms) => {
            if (ms !== DISPOSAL_GRACE_MS) {
              sleeps.push(ms);
            }
          },
        },
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
    const { client, processAdapter, languageClient, spawnProcess } =
      startClient();

    await waitForState(client, "running");
    await client.stop();
    processAdapter.exit();
    stateListenerFor(languageClient)?.({ newState: State.Stopped });
    await flushAsync();

    expect(spawnProcess).toHaveBeenCalledTimes(1);

    client.dispose();
  });

  it("does not spawn again when disposed during unexpected restart backoff", async () => {
    let releaseBackoff = (): void => {};
    const backoffGate = new Promise<void>((resolve) => {
      releaseBackoff = resolve;
    });

    const { client, processAdapter, spawnProcess } = startClient({
      deps: {
        sleep: async (ms) => {
          if (ms === 500) {
            await backoffGate;
          }
        },
      },
    });

    await waitForState(client, "running");
    processAdapter.exit();
    await waitForState(client, "restarting");

    client.dispose();
    releaseBackoff();
    await flushAsync();

    expect(spawnProcess).toHaveBeenCalledTimes(1);
  });

  it("does not restart after an unexpected stop when the project file is gone", async () => {
    const outputChannel = channel();
    let rootPresent = true;

    const { client, processAdapter, spawnProcess } = startClient({
      deps: { rootExists: () => rootPresent },
      options: { outputChannel },
    });
    await waitForState(client, "running");

    rootPresent = false;
    processAdapter.exit();
    await waitForState(client, "stopped");
    await flushAsync();

    expect(spawnProcess).toHaveBeenCalledTimes(1);
    expect(outputChannel.debug).toHaveBeenCalledTimes(1);
    expect(outputChannel.debug).toHaveBeenCalledWith(
      expect.stringContaining("/workspace/general has no dbt_project file"),
    );

    client.dispose();
  });

  it("does not restart when the project file goes during the restart backoff", async () => {
    let rootPresent = true;

    const { client, processAdapter, spawnProcess } = startClient({
      deps: {
        rootExists: () => rootPresent,
        sleep: async () => {
          rootPresent = false;
        },
      },
    });
    await waitForState(client, "running");

    processAdapter.exit();
    await waitForState(client, "stopped");
    await flushAsync();

    expect(spawnProcess).toHaveBeenCalledTimes(1);

    client.dispose();
  });

  it("does not start a client whose project file is already gone", async () => {
    const { client, spawnProcess, createLanguageClient } = startClient({
      deps: { rootExists: () => false },
    });
    await flushAsync();

    expect(client.state).toBe("stopped");
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(createLanguageClient).not.toHaveBeenCalled();

    client.dispose();
  });

  it("resets unexpected exit budget on manual restart", async () => {
    const { client, processAdapter, spawnProcess } = startClient();

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

  it("serializes manual restart requests", async () => {
    const { client, languageClient } = startClient();

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
    const { client } = startClient({
      options: { outputChannel },
      deps: {
        listenForServer: async () => {
          listenAttempts += 1;
          throw new Error(`listen failed ${listenAttempts}`);
        },
      },
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

  it("prefixes workspace/executeCommand requests", async () => {
    const languageClient = makeLanguageClient();
    languageClient.sendRequest.mockResolvedValue({ ok: true } as never);

    const prefix = "fusionPowerUser:req:";
    const { client } = startClient({
      languageClient,
      options: { commandPrefix: prefix },
    });

    await flushAsync();
    await client.request(FUSION_LSP_COMMANDS.compileFile, [
      "file:///workspace/general/models/plain.sql",
    ]);

    expect(languageClient.sendRequest).toHaveBeenCalledWith(
      ExecuteCommandRequest.type,
      {
        command: `${prefix}${FUSION_LSP_COMMANDS.compileFile}`,
        arguments: ["file:///workspace/general/models/plain.sql"],
      },
      undefined,
    );

    await client.stop();
    client.dispose();
  });

  it("sends compileFile the realpath URI when the project is opened through a symlink", async () => {
    const languageClient = makeLanguageClient();
    languageClient.sendRequest.mockResolvedValue({ ok: true } as never);
    const real = fs.mkdtempSync(path.join(os.tmpdir(), "fpu-real-"));
    const link = `${real}-link`;
    fs.symlinkSync(real, link);
    vi.mocked(Uri.parse).mockImplementation((value: string) =>
      VsCodeUri.parse(value),
    );
    try {
      const { client } = startClient({
        languageClient,
        options: { project: makeProject(link), commandPrefix: "p:" },
      });

      await flushAsync();
      await client.request(FUSION_LSP_COMMANDS.compileFile, [
        Uri.file(path.join(link, "models", "a.sql")).toString(),
      ]);

      const sent = languageClient.sendRequest.mock.calls.at(-1)?.[1] as {
        arguments: string[];
      };
      expect(sent.arguments).toEqual([
        Uri.file(
          path.join(fs.realpathSync.native(real), "models", "a.sql"),
        ).toString(),
      ]);
      await client.stop();
      client.dispose();
    } finally {
      vi.mocked(Uri.parse).mockReset();
      fs.rmSync(link, { force: true });
      fs.rmSync(real, { recursive: true, force: true });
    }
  });

  it("never has two listNodes requests in flight for concurrent upstream and downstream lineage", async () => {
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
    const { client } = startClient({
      languageClient,
      options: { commandPrefix: "fusionPowerUser:q:" },
    });
    await waitForState(client, "running");
    const lsp = createFusionCommands(() => client);
    const service = new DbtLineageService({
      queryManifestService: {} as any,
      currentClient: () => client,
      currentLsp: () => lsp,
    });

    const [upstream, downstream] = await Promise.all([
      service.getConnectedColumns(
        {
          targets: [
            ["model.p.b", "total"],
            ["model.p.b", "n"],
          ],
          upstreamExpansion: false,
        },
        new CancellationTokenSource().token,
      ),
      service.getConnectedColumns(
        {
          targets: [["model.p.b", "total"]],
          upstreamExpansion: true,
        },
        new CancellationTokenSource().token,
      ),
    ]);

    // The two `total` requests are identical, so they share one entry: one listNodes that fails for both callers.
    expect(listNodes).toBe(2);
    expect(peak).toBe(1);
    expect(upstream).toEqual({
      kind: "lineage",
      columnLineage: [],
      failures: [{ target: ["model.p.b", "total"], message: "boom" }],
    });
    expect(downstream).toEqual({
      kind: "noLineage",
      reason: { kind: "failed", message: "boom" },
    });

    await client.stop();
    client.dispose();
  });
});

describe("FusionLanguageClient nested roots", () => {
  /** A root list the test can grow, firing the change event the way the registry does. */
  function nestedSource() {
    const roots: Uri[] = [];
    const listeners = new Set<() => void>();
    return {
      source: {
        roots: () => roots,
        onDidChange: (listener: () => void) => {
          listeners.add(listener);
          return { dispose: () => listeners.delete(listener) };
        },
      },
      declare: (rootPath: string) => {
        roots.push(Uri.file(rootPath));
        for (const listener of listeners) {
          listener();
        }
      },
    };
  }

  const documentAt = (path: string) => ({ uri: Uri.file(path) }) as any;

  async function startNested(
    source: ReturnType<typeof nestedSource>["source"],
  ) {
    const languageClient = {
      ...makeLanguageClient(),
      sendNotification: vi.fn(() => Promise.resolve()),
    };
    const started = startClient({
      languageClient,
      options: { nestedRoots: source },
    });
    await waitForState(started.client, "running");
    const options = started.createLanguageClient.mock.calls[0]?.[3] as
      | LanguageClientOptions
      | undefined;
    return {
      client: started.client,
      languageClient,
      createLanguageClient: started.createLanguageClient,
      middleware: options?.middleware as any,
    };
  }

  it("stops forwarding documents once a root is declared later, without restarting", async () => {
    const nested = nestedSource();
    const { client, createLanguageClient, middleware } = await startNested(
      nested.source,
    );
    const inner = "/workspace/general/inner/models/inner_model.sql";

    const before = vi.fn();
    await middleware.didOpen(documentAt(inner), before);
    expect(before).toHaveBeenCalledTimes(1);

    nested.declare("/workspace/general/inner");
    const after = vi.fn();
    await middleware.didOpen(documentAt(inner), after);

    expect(after).not.toHaveBeenCalled();
    expect(createLanguageClient).toHaveBeenCalledTimes(1);
    await client.stop();
    client.dispose();
  });

  it("sends didClose for an open document that a later-declared root excludes", async () => {
    const nested = nestedSource();
    const { client, languageClient, middleware } = await startNested(
      nested.source,
    );
    const inner = "/workspace/general/inner/models/inner_model.sql";
    await middleware.didOpen(documentAt(inner), vi.fn());
    expect(client.openDocuments?.map((uri) => uri.fsPath)).toEqual([inner]);

    nested.declare("/workspace/general/inner");

    expect(languageClient.sendNotification).toHaveBeenCalledWith(
      expect.anything(),
      { textDocument: { uri: Uri.file(inner).toString() } },
    );
    expect(client.openDocuments).toEqual([]);
    await client.stop();
    client.dispose();
  });

  it("drops the outer client's diagnostics for a document a later-declared root excludes", async () => {
    const nested = nestedSource();
    const { client, languageClient, middleware } = await startNested(
      nested.source,
    );
    const diagnostics = { delete: vi.fn() };
    (languageClient as any).diagnostics = diagnostics;
    const inner = Uri.file("/workspace/general/inner/models/inner_model.sql");
    await middleware.didOpen(documentAt(inner.fsPath), vi.fn());

    nested.declare("/workspace/general/inner");

    expect(diagnostics.delete).toHaveBeenCalledWith(inner);
    await client.stop();
    client.dispose();
  });
});
