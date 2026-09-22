import * as net from "net";

export interface Disposable {
  dispose(): void;
}

export interface ReverseSocketStreams {
  reader: NodeJS.ReadableStream;
  writer: NodeJS.WritableStream;
}

/** Ephemeral loopback listener the dbt process dials back to. */
export interface ReverseSocketServer extends Disposable {
  readonly port: number;
  accept(timeoutMs: number): Promise<ReverseSocketStreams>;
}

/**
 * Minimal process shape for racing accept against early exit.
 * `exitCode` and `signalCode` must read live values on each access, not
 * snapshots captured when the adapter was constructed.
 */
export interface ExitingProcess {
  get exitCode(): number | null;
  get signalCode(): NodeJS.Signals | null;
  on(event: "exit", listener: () => void): void;
  removeListener(event: "exit", listener: () => void): void;
  getStderr(): string;
}

type AcceptState = "idle" | "pending" | "accepted" | "settled";

class ReverseSocketServerImpl implements ReverseSocketServer {
  private socket: net.Socket | null = null;
  private disposed = false;
  private acceptState: AcceptState = "idle";
  private latchedError: Error | null = null;
  private pendingAccept: {
    resolve: (streams: ReverseSocketStreams) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;

  constructor(
    private readonly server: net.Server,
    private readonly boundPort: number,
  ) {
    server.on("connection", (incoming) => this.onConnection(incoming));
    server.on("error", (error) => this.onServerError(error));
  }

  get port(): number {
    return this.boundPort;
  }

  accept(timeoutMs: number): Promise<ReverseSocketStreams> {
    if (this.disposed) {
      return Promise.reject(new Error("ReverseSocketServer disposed"));
    }
    if (this.latchedError) {
      return Promise.reject(this.latchedError);
    }
    if (this.acceptState === "accepted") {
      return Promise.reject(new Error("Connection already accepted"));
    }
    if (this.acceptState === "settled") {
      return Promise.reject(new Error("accept already called"));
    }
    if (this.acceptState === "pending") {
      return Promise.reject(new Error("accept already in progress"));
    }

    if (this.socket) {
      this.acceptState = "accepted";
      return Promise.resolve(this.streamsFor(this.socket));
    }

    this.acceptState = "pending";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingAccept = null;
        this.acceptState = "settled";
        this.server.close();
        reject(
          new Error(`Reverse socket connection timed out after ${timeoutMs}ms`),
        );
      }, timeoutMs);

      this.pendingAccept = { resolve, reject, timer };
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.rejectPending(new Error("ReverseSocketServer disposed"));
    this.server.close();
    this.socket?.destroy();
    this.socket = null;
  }

  private onConnection(incoming: net.Socket): void {
    if (this.shouldRefuseConnection()) {
      incoming.destroy();
      return;
    }

    this.storeSocket(incoming);

    const pending = this.pendingAccept;
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pendingAccept = null;
    this.acceptState = "accepted";
    pending.resolve(this.streamsFor(incoming));
  }

  private onServerError(error: Error): void {
    this.latchedError = error;
    this.server.close();
    this.rejectPending(error);
  }

  private rejectPending(error: Error): void {
    const pending = this.pendingAccept;
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pendingAccept = null;
    if (this.acceptState === "pending") {
      this.acceptState = "settled";
    }
    pending.reject(error);
  }

  private shouldRefuseConnection(): boolean {
    return (
      this.disposed ||
      this.acceptState === "accepted" ||
      this.acceptState === "settled" ||
      this.socket !== null
    );
  }

  private storeSocket(incoming: net.Socket): void {
    incoming.on("error", () => {
      incoming.destroy();
    });
    this.socket = incoming;
    this.server.close();
  }

  private streamsFor(socket: net.Socket): ReverseSocketStreams {
    return { reader: socket, writer: socket };
  }
}

export function listenForServer(): Promise<ReverseSocketServer> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    const onListenError = (error: Error) => {
      reject(error);
    };

    server.once("error", onListenError);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", onListenError);
      const address = server.address();
      if (!address || typeof address !== "object") {
        server.close();
        reject(new Error("Failed to bind reverse socket listener"));
        return;
      }
      resolve(new ReverseSocketServerImpl(server, address.port));
    });
  });
}

function processExitError(process: ExitingProcess): Error {
  const stderr = process.getStderr().trim();
  if (stderr) {
    return new Error(`dbt lsp exited before connecting: ${stderr}`);
  }
  return new Error("dbt lsp exited before connecting");
}

function rejectAfterDispose(
  server: ReverseSocketServer,
  error: Error,
): Promise<never> {
  server.dispose();
  return Promise.reject(error);
}

/**
 * Races `accept` against process exit. When the process exits before a
 * connection arrives, disposes the supplied server before rejecting. On
 * success, the accepted socket stays open; the caller owns disposal of the
 * returned streams and the server.
 */
export function acceptWithProcessExit(
  server: ReverseSocketServer,
  process: ExitingProcess,
  timeoutMs: number,
): Promise<ReverseSocketStreams> {
  if (process.exitCode !== null || process.signalCode !== null) {
    return rejectAfterDispose(server, processExitError(process));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const onExit = () => {
      settle(() => {
        server.dispose();
        reject(processExitError(process));
      });
    };

    const settle = (next: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      process.removeListener("exit", onExit);
      next();
    };

    process.on("exit", onExit);
    server.accept(timeoutMs).then(
      (streams) => settle(() => resolve(streams)),
      (error) => settle(() => reject(error)),
    );
  });
}
