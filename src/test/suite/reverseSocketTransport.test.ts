import { afterEach, describe, expect, it } from "@jest/globals";
import { EventEmitter } from "events";
import * as net from "net";
import type { StreamInfo } from "vscode-languageclient/node";
import {
  acceptWithProcessExit,
  ExitingProcess,
  listenForServer,
  ReverseSocketServer,
  ReverseSocketStreams,
} from "../../lsp/reverseSocketTransport";

class FakeExitingProcess extends EventEmitter implements ExitingProcess {
  private _exitCode: number | null = null;
  private _signalCode: NodeJS.Signals | null = null;
  private stderr = "";

  get exitCode(): number | null {
    return this._exitCode;
  }

  get signalCode(): NodeJS.Signals | null {
    return this._signalCode;
  }

  getStderr(): string {
    return this.stderr;
  }

  setStderr(value: string): void {
    this.stderr = value;
  }

  exit(code: number | null = 1): void {
    this._exitCode = code;
    this.emit("exit");
  }
}

function internalNetServer(server: ReverseSocketServer): net.Server {
  return (server as unknown as { server: net.Server }).server;
}

function assertStreamInfoAssignable(streams: ReverseSocketStreams): StreamInfo {
  return streams;
}

async function connectClient(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => {
      resolve(socket);
    });
    socket.once("error", reject);
  });
}

async function connectClientOrReset(
  port: number,
): Promise<net.Socket | "reset"> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => {
      resolve(socket);
    });
    socket.once("error", (error: Error) => {
      if (/ECONNRESET/.test(error.message)) {
        resolve("reset");
        return;
      }
      reject(error);
    });
  });
}

const supportsResetAndDestroy =
  typeof net.Socket.prototype.resetAndDestroy === "function";

async function waitForSocketClose(
  socket: net.Socket,
  timeoutMs = 500,
): Promise<void> {
  if (socket.destroyed) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("socket did not close after reset")),
      timeoutMs,
    );
    socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe("reverseSocketTransport", () => {
  let server: ReverseSocketServer | undefined;

  afterEach(() => {
    server?.dispose();
    server = undefined;
  });

  it("binds loopback and accepts a usable duplex stream", async () => {
    server = await listenForServer();
    expect(server.port).toBeGreaterThan(0);

    const acceptPromise = server.accept(1_000);
    const client = await connectClient(server.port);
    const streams = await acceptPromise;

    assertStreamInfoAssignable(streams);
    expect(typeof streams.reader.read).toBe("function");
    expect(typeof streams.writer.write).toBe("function");

    const payload = Buffer.from("ping");
    await new Promise<void>((resolve, reject) => {
      client.once("data", (chunk) => {
        try {
          expect(chunk.equals(payload)).toBe(true);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      streams.writer.write(payload);
    });

    client.destroy();
  });

  it("rejects accept on timeout and closes the listener", async () => {
    server = await listenForServer();
    const internalServer = internalNetServer(server);
    await expect(server.accept(50)).rejects.toThrow(/timed out after 50ms/);
    expect(internalServer.listening).toBe(false);
    await expect(server.accept(50)).rejects.toThrow("accept already called");
  });

  it("refuses a late client after accept settles on timeout", async () => {
    server = await listenForServer();
    await expect(server.accept(50)).rejects.toThrow(/timed out/);
    await expect(connectClient(server.port)).rejects.toThrow(/ECONNREFUSED/);
  });

  it("rejects when the process exits before connect and disposes the listener", async () => {
    server = await listenForServer();
    const internalServer = internalNetServer(server);
    const process = new FakeExitingProcess();
    process.setStderr("bad profiles.yml");

    const pending = acceptWithProcessExit(server, process, 5_000);
    process.exit(1);

    await expect(pending).rejects.toThrow(
      "dbt lsp exited before connecting: bad profiles.yml",
    );
    expect(process.listenerCount("exit")).toBe(0);
    expect(internalServer.listening).toBe(false);
    await expect(connectClient(server.port)).rejects.toThrow(/ECONNREFUSED/);
  });

  it("removes the process exit listener after a successful connect", async () => {
    server = await listenForServer();
    const process = new FakeExitingProcess();

    const pending = acceptWithProcessExit(server, process, 5_000);
    const client = await connectClient(server.port);
    await pending;

    expect(process.listenerCount("exit")).toBe(0);
    client.destroy();
  });

  it("rejects and disposes when the process has already exited", async () => {
    server = await listenForServer();
    const internalServer = internalNetServer(server);
    const process = new FakeExitingProcess();
    process.setStderr("startup failed");
    process.exit(1);

    await expect(acceptWithProcessExit(server, process, 5_000)).rejects.toThrow(
      "dbt lsp exited before connecting: startup failed",
    );
    expect(process.listenerCount("exit")).toBe(0);
    expect(internalServer.listening).toBe(false);
  });

  it("rejects pending accept when the listener errors", async () => {
    server = await listenForServer();
    const acceptPromise = server.accept(5_000);
    internalNetServer(server).emit("error", new Error("listener failed"));

    await expect(acceptPromise).rejects.toThrow("listener failed");
  });

  it("latches a listener error before accept is pending", async () => {
    server = await listenForServer();
    internalNetServer(server).emit("error", new Error("latched failure"));

    await expect(server.accept(5_000)).rejects.toThrow("latched failure");
    await expect(server.accept(50)).rejects.toThrow("latched failure");
  });

  it("disposes idempotently before, during, and after accept", async () => {
    server = await listenForServer();
    server.dispose();
    server.dispose();
    await expect(server.accept(50)).rejects.toThrow(
      "ReverseSocketServer disposed",
    );

    server = await listenForServer();
    const pending = server.accept(5_000);
    server.dispose();
    await expect(pending).rejects.toThrow("ReverseSocketServer disposed");
    server.dispose();

    server = await listenForServer();
    const client = await connectClient(server.port);
    const streams = await server.accept(5_000);
    server.dispose();
    server.dispose();
    expect((streams.reader as net.Socket).destroyed).toBe(true);
    client.destroy();
  });

  it("stops listening after the first connection and rejects a second accept", async () => {
    server = await listenForServer();
    const internalServer = internalNetServer(server);
    const acceptPromise = server.accept(5_000);
    const client = await connectClient(server.port);
    const streams = await acceptPromise;

    expect(internalServer.listening).toBe(false);
    await expect(server.accept(50)).rejects.toThrow(
      "Connection already accepted",
    );

    client.destroy();
    expect((streams.reader as net.Socket).destroyed).toBe(false);
  });

  it("destroys a racing second client without accepting it", async () => {
    server = await listenForServer();
    const [streams, firstClient, secondOutcome] = await Promise.all([
      server.accept(5_000),
      connectClient(server.port),
      connectClientOrReset(server.port),
    ]);
    const accepted = streams.reader as net.Socket;

    if (secondOutcome === "reset") {
      expect(firstClient.destroyed).toBe(false);
      firstClient.destroy();
      return;
    }

    const secondClient = secondOutcome;
    expect(secondClient).not.toBe(accepted);
    await new Promise<void>((resolve, reject) => {
      if (secondClient.destroyed) {
        resolve();
        return;
      }
      const timer = setTimeout(
        () => reject(new Error("second client was not reset or closed")),
        500,
      );
      secondClient.once("error", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    expect(secondClient.destroyed).toBe(true);
    expect(firstClient.destroyed).toBe(false);
    firstClient.destroy();
  });

  (supportsResetAndDestroy ? it : it.skip)(
    "survives peer reset after connect-before-accept without uncaught errors",
    async () => {
      server = await listenForServer();
      const uncaught: Error[] = [];
      const onUncaught = (error: Error) => {
        uncaught.push(error);
      };
      process.on("uncaughtException", onUncaught);

      try {
        const client = await connectClient(server.port);
        const streams = await server.accept(5_000);
        const accepted = streams.reader as net.Socket;

        client.resetAndDestroy();
        await waitForSocketClose(accepted);

        expect(accepted.destroyed).toBe(true);
        expect(uncaught).toEqual([]);
      } finally {
        process.removeListener("uncaughtException", onUncaught);
      }
    },
  );

  it("does not leak timers or exit listeners on timeout", async () => {
    server = await listenForServer();
    const process = new FakeExitingProcess();
    const internalServer = internalNetServer(server);

    const pending = acceptWithProcessExit(server, process, 50);
    await expect(pending).rejects.toThrow(/timed out/);
    expect(process.listenerCount("exit")).toBe(0);
    expect(internalServer.listening).toBe(false);
  });
});
