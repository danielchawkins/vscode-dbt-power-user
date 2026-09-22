import { ChildProcess, spawn } from "child_process";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import {
  acceptWithProcessExit,
  ExitingProcess,
  listenForServer,
  ReverseSocketServer,
} from "../../lsp/reverseSocketTransport";

/**
 * Spawns `dbt lsp` against a fixture and speaks LSP over the reverse socket
 * without the extension. This allows testing protocol behavior independently.
 */

export interface LspFixture {
  port: number;
  connect(timeoutMs: number): Promise<void>;
  close(): Promise<void>;
  request<T = unknown>(method: string, params: unknown): Promise<T>;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
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
): Promise<LspFixture> {
  let port = 0;
  let childProcess: ChildProcess | null = null;
  let socket: net.Socket | null = null;
  let reverseServer: ReverseSocketServer | null = null;
  let stderr = "";
  let closed = false;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fusion-lsp-"));
  const temporaryProjectRoot = path.join(tempDir, path.basename(projectRoot));
  fs.cpSync(projectRoot, temporaryProjectRoot, { recursive: true });
  const temporaryProfilesDir =
    profilesDir && path.resolve(profilesDir) === path.resolve(projectRoot)
      ? temporaryProjectRoot
      : profilesDir;

  return {
    get port() {
      return port;
    },

    async connect(timeoutMs: number): Promise<void> {
      if (socket) {
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

      stderr = "";
      childProcess = spawn("dbt", args, {
        stdio: ["ignore", "inherit", "pipe"],
      });
      childProcess.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8");
      });

      try {
        const streams = await acceptWithProcessExit(
          reverseServer,
          childProcessAdapter(childProcess, () => stderr),
          timeoutMs,
        );
        socket = streams.reader as net.Socket;
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

      if (socket) {
        socket.destroy();
        socket = null;
      }

      reverseServer?.dispose();
      reverseServer = null;

      if (childProcess) {
        const child = childProcess;
        childProcess = null;
        await terminateChild(child);
      }

      fs.rmSync(tempDir, { recursive: true, force: true });
    },

    async request<T>(method: string, params: unknown): Promise<T> {
      if (!socket) {
        throw new Error("Not connected");
      }

      const id = Math.floor(Math.random() * 1_000_000);
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      return new Promise((resolve, reject) => {
        let buffer = Buffer.alloc(0);
        const delimiter = Buffer.from("\r\n\r\n");

        const onData = (chunk: Buffer) => {
          buffer = Buffer.concat([buffer, chunk]);

          while (true) {
            const delimiterIndex = buffer.indexOf(delimiter);
            if (delimiterIndex === -1) {
              return;
            }
            const headerSection = buffer
              .subarray(0, delimiterIndex)
              .toString("ascii");

            const match = headerSection.match(/Content-Length: (\d+)/);
            if (!match) {
              settle(new Error("LSP response is missing Content-Length"));
              return;
            }

            const contentLength = parseInt(match[1], 10);
            const bodyStart = delimiterIndex + delimiter.length;
            const bodyEnd = bodyStart + contentLength;
            if (buffer.length < bodyEnd) {
              return;
            }

            const json = buffer.subarray(bodyStart, bodyEnd).toString("utf-8");
            buffer = buffer.subarray(bodyEnd);

            try {
              const response = JSON.parse(json) as JsonRpcResponse<T>;
              if (response.id === id) {
                if (response.error) {
                  settle(new Error(`LSP error: ${response.error.message}`));
                } else {
                  settle(undefined, response.result as T);
                }
                return;
              }
            } catch {
              // Malformed JSON; continue reading
            }
          }
        };

        const onError = (err: Error) => settle(err);
        const onClose = () => settle(new Error("LSP connection closed"));
        const settle = (error?: Error, result?: T) => {
          clearTimeout(timer);
          socket?.removeListener("data", onData);
          socket?.removeListener("error", onError);
          socket?.removeListener("close", onClose);
          if (error) {
            reject(error);
          } else {
            resolve(result as T);
          }
        };

        const timer = setTimeout(() => {
          settle(new Error(`LSP request ${method} timed out after 10s`));
        }, 10_000);

        if (socket) {
          socket.on("data", onData);
          socket.on("error", onError);
          socket.on("close", onClose);

          const json = JSON.stringify(request);
          const headers = `Content-Length: ${Buffer.byteLength(
            json,
            "utf-8",
          )}\r\n\r\n`;
          socket.write(headers);
          socket.write(json);
        }
      });
    },
  };
}
