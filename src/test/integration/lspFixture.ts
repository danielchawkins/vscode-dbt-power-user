import { ChildProcess, spawn } from "child_process";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import type { Disposable } from "../../lsp/reverseSocketTransport";
import {
  acceptWithProcessExit,
  ExitingProcess,
  listenForServer,
  ReverseSocketServer,
} from "../../lsp/reverseSocketTransport";
import {
  attachLspProtocolClient,
  CAPTURE_LIMITS,
  CapturedError,
  LspProtocolClient,
  NotificationEntry,
  ServerRequestEntry,
} from "./lspProtocolClient";

/**
 * Spawns `dbt lsp` against a fixture and speaks LSP over the reverse socket
 * without the extension. Raw params, URIs, and diagnostic text are retained in
 * memory only for assertions and are never logged or persisted by the harness;
 * callers must redact before writing artifacts.
 */

export interface LspFixture {
  port: number;
  /** Temp copy root passed to `dbt lsp --project-dir`. */
  readonly projectRoot: string;
  connect(timeoutMs: number): Promise<void>;
  close(): Promise<void>;
  request<T = unknown>(
    method: string,
    params: unknown,
    timeoutMs?: number,
  ): Promise<T>;
  notify(method: string, params?: unknown): void;
  onNotification(
    method: string,
    handler: (params: unknown) => void,
  ): Disposable;
  onRequest(
    method: string,
    handler: (params: unknown) => unknown | Promise<unknown>,
  ): Disposable;
  waitForNotification(
    method: string,
    predicate: (params: unknown) => boolean,
    timeoutMs: number,
    fromIndex?: number,
  ): Promise<unknown>;
  notificationCount(method: string): number;
  serverRequestCount(method: string): number;
  getNotifications(method: string): readonly unknown[];
  getNotificationsSince(method: string, fromCursor: number): readonly unknown[];
  getNotificationEntries(method: string): readonly NotificationEntry[];
  getServerRequests(method: string): readonly ServerRequestEntry[];
  getServerRequestsSince(
    method: string,
    fromCursor: number,
  ): readonly ServerRequestEntry[];
  getErrors(): readonly CapturedError[];
  getStderr(): string;
  setWorkspaceConfiguration(response: unknown[]): void;
}

export interface LspFixtureOptions {
  prepareProject?: (projectRoot: string) => void;
  workspaceConfiguration?: unknown[];
  defaultRequestTimeoutMs?: number;
  /** Extra `dbt lsp` argv tokens, e.g. `--static-analysis strict`. */
  extraArgs?: string[];
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

function cappedStderrTail(stderr: string): string {
  if (stderr.length <= CAPTURE_LIMITS.stderrBytes) {
    return stderr;
  }
  return stderr.slice(-CAPTURE_LIMITS.stderrBytes);
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
  let childProcess: ChildProcess | null = null;
  let client: LspProtocolClient | null = null;
  let reverseServer: ReverseSocketServer | null = null;
  let stderr = "";
  let closed = false;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fusion-lsp-"));
  const temporaryProjectRoot = path.join(tempDir, path.basename(projectRoot));
  fs.cpSync(projectRoot, temporaryProjectRoot, { recursive: true });
  options.prepareProject?.(temporaryProjectRoot);
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
      if (options.extraArgs) {
        args.push(...options.extraArgs);
      }

      stderr = "";
      childProcess = spawn("dbt", args, {
        stdio: ["ignore", "pipe", "pipe"],
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
        client = attachLspProtocolClient(streams.reader as net.Socket, {
          workspaceConfiguration: options.workspaceConfiguration,
          defaultRequestTimeoutMs: options.defaultRequestTimeoutMs,
        });
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

    serverRequestCount(method: string): number {
      return requireClient().serverRequestCount(method);
    },

    getNotifications(method: string): readonly unknown[] {
      return requireClient().getNotifications(method);
    },

    getNotificationsSince(
      method: string,
      fromCursor: number,
    ): readonly unknown[] {
      return requireClient().getNotificationsSince(method, fromCursor);
    },

    getNotificationEntries(method: string): readonly NotificationEntry[] {
      return requireClient().getNotificationEntries(method);
    },

    getServerRequests(method: string): readonly ServerRequestEntry[] {
      return requireClient().getServerRequests(method);
    },

    getServerRequestsSince(
      method: string,
      fromCursor: number,
    ): readonly ServerRequestEntry[] {
      return requireClient().getServerRequestsSince(method, fromCursor);
    },

    getErrors(): readonly CapturedError[] {
      return requireClient().getErrors();
    },

    getStderr(): string {
      return cappedStderrTail(stderr);
    },

    setWorkspaceConfiguration(response: unknown[]): void {
      requireClient().setWorkspaceConfiguration(response);
    },
  };
}
