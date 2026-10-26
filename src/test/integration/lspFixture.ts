import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import type * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import type {
  Disposable,
  ExitingProcess,
  ReverseSocketServer,
} from "../../fusion/reverseSocketTransport";
import {
  acceptWithProcessExit,
  listenForServer,
} from "../../fusion/reverseSocketTransport";
import type {
  CapturedError,
  LspProtocolClient,
  ServerRequestEntry,
} from "./lspProtocolClient";
import { attachLspProtocolClient, CAPTURE_LIMITS } from "./lspProtocolClient";

/**
 * Spawns `dbt lsp` against a fixture and speaks LSP over the reverse socket
 * without the extension. Raw params, URIs, and diagnostic text are retained in
 * memory only for assertions and are never logged or persisted by the harness;
 * callers must redact before writing artifacts.
 */

export interface LspFixture extends Pick<
  LspProtocolClient,
  | "request"
  | "notify"
  | "onNotification"
  | "onRequest"
  | "waitForNotification"
  | "notificationCount"
  | "getNotificationsSince"
  | "getServerRequestsSince"
  | "configurationDeliveryCount"
  | "getErrors"
> {
  port: number;
  /** Temp copy root on disk; always the real, non-symlinked path. */
  readonly projectRoot: string;
  /** argv passed to `dbt` at connect; empty until connected. */
  readonly launchArgs: readonly string[];
  connect(timeoutMs: number): Promise<void>;
  close(): Promise<void>;
}

export interface LspFixtureOptions {
  prepareProject?: (projectRoot: string) => void;
  /** Environment variables for `dbt lsp` spawn; merged over process.env. */
  env?: Record<string, string>;
  /** Fusion executable; defaults to `dbt` on PATH. */
  executable?: string;
  /** Spawn from the copied project root. */
  useProjectRootAsCwd?: boolean;
}

function waitForExit(
  child: ChildProcess,
  timeoutMs?: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    const onExit = () => {
      if (timer) {
        clearTimeout(timer);
      }
      resolve(true);
    };

    child.once("exit", onExit);
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        child.removeListener("exit", onExit);
        resolve(false);
      }, timeoutMs);
    }
  });
}

async function terminateChild(child: ChildProcess): Promise<void> {
  child.kill("SIGTERM");
  if (!(await waitForExit(child, 500))) {
    child.kill("SIGKILL");
    await waitForExit(child);
  }
}

function connectFailure(error: unknown, stderr: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  const detail = stderr.trim();
  if (detail) {
    return new Error(`${message}; dbt stderr:\n${detail}`);
  }
  return error instanceof Error ? error : new Error(message);
}

function childProcessAdapter(
  child: ChildProcess,
  getStderr: () => string,
): ExitingProcess {
  return {
    get exitCode() {
      return child.exitCode;
    },
    get signalCode() {
      return child.signalCode;
    },
    on: (event, listener) => child.on(event, listener),
    removeListener: (event, listener) => child.removeListener(event, listener),
    getStderr,
  };
}

/**
 * Creates a reverse-socket harness for testing dbt lsp directly.
 * Binds 127.0.0.1:0 (ephemeral), spawns dbt lsp --socket <port>,
 * waits for inbound connection, speaks LSP-JSON-RPC.
 */
export async function createLspFixture(
  projectRoot: string,
  profilesDir?: string,
  options: LspFixtureOptions = {},
): Promise<LspFixture> {
  let port = 0;
  let launchArgs: readonly string[] = [];
  let childProcess: ChildProcess | null = null;
  let client: LspProtocolClient | null = null;
  let reverseServer: ReverseSocketServer | null = null;
  let stderr = "";
  let closed = false;
  // realpathSync resolves macOS's /tmp -> /private/tmp symlink; Fusion canonicalizes
  // --project-dir but not document URIs, so a symlinked root can desync the two.
  const tempDir = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "fusion-lsp-"),
  );
  const temporaryProjectRoot = path.join(tempDir, path.basename(projectRoot));
  fs.cpSync(projectRoot, temporaryProjectRoot, { recursive: true });
  try {
    options.prepareProject?.(temporaryProjectRoot);
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
  const temporaryProfilesDir =
    profilesDir && path.resolve(profilesDir) === path.resolve(projectRoot)
      ? temporaryProjectRoot
      : profilesDir;

  const requireClient = (): LspProtocolClient => {
    if (!client) {
      throw new Error("Not connected");
    }
    return client;
  };

  return {
    get port() {
      return port;
    },

    get projectRoot() {
      return temporaryProjectRoot;
    },

    get launchArgs() {
      return launchArgs;
    },

    async connect(timeoutMs: number): Promise<void> {
      if (client) {
        throw new Error("Already connected");
      }

      reverseServer = await listenForServer();
      port = reverseServer.port;

      const args = [
        "lsp",
        "--socket",
        String(port),
        "--project-dir",
        temporaryProjectRoot,
      ];
      if (temporaryProfilesDir) {
        args.push("--profiles-dir", temporaryProfilesDir);
      }
      args.push("--no-version-check");
      launchArgs = args;

      stderr = "";
      const spawnEnv = options.env
        ? { ...process.env, ...options.env }
        : undefined;
      childProcess = spawn(options.executable ?? "dbt", args, {
        stdio: ["ignore", "pipe", "pipe"],
        ...(spawnEnv && { env: spawnEnv }),
        ...(options.useProjectRootAsCwd && { cwd: temporaryProjectRoot }),
      });
      childProcess.stdout?.on("data", () => {});
      childProcess.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8");
        if (stderr.length > CAPTURE_LIMITS.stderrBytes * 2) {
          stderr = stderr.slice(-CAPTURE_LIMITS.stderrBytes * 2);
        }
      });

      try {
        const streams = await acceptWithProcessExit(
          reverseServer,
          childProcessAdapter(childProcess, () => stderr),
          timeoutMs,
        );
        client = attachLspProtocolClient(streams.reader as net.Socket);
      } catch (error) {
        reverseServer.dispose();
        reverseServer = null;
        if (childProcess) {
          const child = childProcess;
          childProcess = null;
          await terminateChild(child);
        }
        throw connectFailure(error, stderr);
      }
    },

    async close(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;

      client?.close();
      client = null;

      reverseServer?.dispose();
      reverseServer = null;

      if (childProcess) {
        const child = childProcess;
        childProcess = null;
        await terminateChild(child);
      }

      fs.rmSync(tempDir, { recursive: true, force: true });
    },

    request<T>(
      method: string,
      params: unknown,
      timeoutMs?: number,
    ): Promise<T> {
      return requireClient().request<T>(method, params, timeoutMs);
    },

    notify(method: string, params?: unknown): void {
      requireClient().notify(method, params);
    },

    onNotification(
      method: string,
      handler: (params: unknown) => void,
    ): Disposable {
      return requireClient().onNotification(method, handler);
    },

    onRequest(
      method: string,
      handler: (params: unknown) => unknown | Promise<unknown>,
    ): Disposable {
      return requireClient().onRequest(method, handler);
    },

    waitForNotification(
      method: string,
      predicate: (params: unknown) => boolean,
      timeoutMs: number,
      fromIndex?: number,
    ): Promise<unknown> {
      return requireClient().waitForNotification(
        method,
        predicate,
        timeoutMs,
        fromIndex,
      );
    },

    notificationCount(method: string): number {
      return requireClient().notificationCount(method);
    },

    getNotificationsSince(
      method: string,
      fromCursor: number,
    ): readonly unknown[] {
      return requireClient().getNotificationsSince(method, fromCursor);
    },

    getServerRequestsSince(
      method: string,
      fromCursor: number,
    ): readonly ServerRequestEntry[] {
      return requireClient().getServerRequestsSince(method, fromCursor);
    },

    configurationDeliveryCount(): number {
      return requireClient().configurationDeliveryCount();
    },

    getErrors(): readonly CapturedError[] {
      return requireClient().getErrors();
    },
  };
}
