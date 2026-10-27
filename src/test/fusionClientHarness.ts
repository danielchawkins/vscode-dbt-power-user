import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { vi } from "vitest";
import type { WorkspaceFolder } from "vscode";
import { Uri } from "vscode";
import type { State } from "vscode-languageclient/node";
import type { LspLaunch } from "../core/lsp";
import type {
  FusionClient,
  FusionClientOptions,
  FusionClientState,
} from "../fusion/fusionClient";
import type { FusionExecutable } from "../fusion/fusionExecutable";
import type {
  FusionLanguageClientDependencies,
  ServerSpawnSpec,
} from "../fusion/lspClientSupport";
import type {
  ExitingProcess,
  ReverseSocketServer,
  ReverseSocketStreams,
} from "../fusion/reverseSocketTransport";
import { DefaultFusionClientFactory } from "../languageClient/defaultFusionClientFactory";
import type { DeclaredProject } from "../projects/registry/projectRegistry";
import { createMockLogOutputChannel } from "./mock/vscode";

const folder: WorkspaceFolder = {
  uri: Uri.file("/workspace/general"),
  name: "general",
  index: 0,
};

export function channel() {
  return createMockLogOutputChannel("Fusion Power User: general");
}

/** The executable the tests share, as the resolver returns it. `overrides` replace any field. */
export function makeExecutable(
  overrides: Partial<FusionExecutable> = {},
): FusionExecutable {
  return {
    path: "/opt/dbt",
    version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
    env: {},
    ...overrides,
  };
}

export function makeProject(
  rootPath = "/workspace/general",
  name = "general",
): DeclaredProject {
  return {
    root: Uri.file(rootPath),
    name,
    folder,
    origin: "explicit",
    contains: () => false,
    dispose: () => {},
  };
}

export function makeLaunch(overrides: Partial<LspLaunch> = {}): LspLaunch {
  return {
    executable: { source: "path" },
    projectDir: "/workspace/general",
    target: undefined,
    profile: undefined,
    profilesDir: undefined,
    staticAnalysis: "baseline",
    lintEnabled: true,
    maxErrorReporting: undefined,
    logLevel: undefined,
    environment: {},
    ...overrides,
  };
}

export function makeStreams(): ReverseSocketStreams {
  return {
    reader: new PassThrough(),
    writer: new PassThrough(),
  };
}

export class FakeReverseSocketServer implements ReverseSocketServer {
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

export function makeLanguageClient() {
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

export function stateListenerFor(
  languageClient: ReturnType<typeof makeLanguageClient>,
): ((event: { newState: State }) => void) | undefined {
  const calls = languageClient.onDidChangeState.mock.calls;
  return calls.at(-1)?.[0];
}

export async function waitForState(
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

export interface StartClientOverrides {
  /** Replaces any factory dependency; the rest are the usual fakes. */
  deps?: Partial<FusionLanguageClientDependencies>;
  /** Replaces any `create` option; the rest are the usual project, executable and launch. */
  options?: Partial<FusionClientOptions>;
  /** What the factory's `createLanguageClient` resolves to; a fresh fake by default. */
  languageClient?: ReturnType<typeof makeLanguageClient>;
}

/**
 * Builds a Fusion Client over fakes for the reverse socket, the process and the language client.
 * Returns before the client has started; callers wait for the state they need.
 */
export function startClient({
  deps = {},
  options = {},
  languageClient = makeLanguageClient(),
}: StartClientOverrides = {}) {
  const streams = makeStreams();
  const server = new FakeReverseSocketServer(streams);
  const processAdapter = new FakeExitingProcess();
  const spawnProcess = vi.fn((_spec: ServerSpawnSpec) => processAdapter as any);
  const createLanguageClient = vi.fn(
    async (..._args: unknown[]) => languageClient as any,
  );
  const factory = new DefaultFusionClientFactory({
    rootExists: () => true,
    listenForServer: async () => server,
    acceptWithProcessExit: async () => streams,
    spawnProcess,
    createLanguageClient,
    sleep: async () => {},
    ...deps,
  });
  const client = factory.create({
    project: makeProject(),
    executable: makeExecutable(),
    launch: makeLaunch(),
    commandPrefix: "fusionPowerUser:test:",
    outputChannel: channel(),
    targetPath: "/workspace/general/target",
    ...options,
  });
  return {
    client,
    server,
    streams,
    processAdapter,
    languageClient,
    spawnProcess,
    createLanguageClient,
  };
}
