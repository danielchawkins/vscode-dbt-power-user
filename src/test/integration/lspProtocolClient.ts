import * as net from "net";
import type { Disposable } from "../../lsp/reverseSocketTransport";

const HEADER_DELIMITER = Buffer.from("\r\n\r\n");

/** Per-method capture and stderr bounds for in-memory retention only. */
export const CAPTURE_LIMITS = {
  notificationsPerMethod: 1_000,
  serverRequestsPerMethod: 500,
  errors: 100,
  stderrBytes: 16_384,
} as const;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcServerRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

type RequestHandler = (params: unknown) => unknown | Promise<unknown>;
type NotificationHandler = (params: unknown) => void;

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface NotificationWait {
  method: string;
  fromIndex: number;
  predicate: (params: unknown) => boolean;
  resolve: (params: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface CaptureState<T> {
  entries: T[];
  totalReceived: number;
  droppedCount: number;
}

export interface CapturedError {
  method: string;
  error: Error;
}

/** JSON-RPC error from an LSP request response. */
export class LspRequestError extends Error {
  readonly method: string;
  readonly code: number;
  readonly data?: unknown;

  constructor(method: string, code: number, message: string, data?: unknown) {
    super(message);
    this.name = "LspRequestError";
    this.method = method;
    this.code = code;
    this.data = data;
  }
}

export interface NotificationEntry {
  params: unknown;
  receivedAtMs: number;
  size: number;
  /** Absolute sequence index; stable across bounded-buffer shifts. */
  absoluteIndex: number;
}

export interface ServerRequestEntry {
  method: string;
  params: unknown;
  receivedAtMs: number;
  size: number;
  /** Absolute sequence index; stable across bounded-buffer shifts. */
  absoluteIndex: number;
}

export interface ConfigurationDeliveryEntry {
  requestedSections: string[];
  deliveredSections: string[];
  absoluteIndex: number;
}

export interface LspProtocolClientOptions {
  defaultRequestTimeoutMs?: number;
  workspaceConfiguration?: unknown[];
  /** Maps LSP configuration section strings to response objects. */
  configurationBySection?: Record<string, unknown>;
  notificationsPerMethod?: number;
  serverRequestsPerMethod?: number;
}

/**
 * Persistent LSP-JSON-RPC client for integration captures.
 * Raw params, URIs, and diagnostic text are retained in memory only for
 * assertions and are never logged or persisted by the harness; callers must
 * redact before writing artifacts. Timeout and protocol error messages name
 * the method only, never payload content.
 */
export interface LspProtocolClient {
  request<T = unknown>(
    method: string,
    params: unknown,
    timeoutMs?: number,
  ): Promise<T>;
  notify(method: string, params?: unknown): void;
  onNotification(method: string, handler: NotificationHandler): Disposable;
  onRequest(method: string, handler: RequestHandler): Disposable;
  waitForNotification(
    method: string,
    predicate: (params: unknown) => boolean,
    timeoutMs: number,
    fromIndex?: number,
  ): Promise<unknown>;
  /** Absolute next cursor for the method (total received count). */
  notificationCount(method: string): number;
  /** Absolute next cursor for the method (total received count). */
  serverRequestCount(method: string): number;
  getNotifications(method: string): readonly unknown[];
  getNotificationsSince(method: string, fromCursor: number): readonly unknown[];
  getNotificationEntries(method: string): readonly NotificationEntry[];
  getServerRequests(method: string): readonly ServerRequestEntry[];
  getServerRequestsSince(
    method: string,
    fromCursor: number,
  ): readonly ServerRequestEntry[];
  configurationDeliveryCount(): number;
  getConfigurationDeliveriesSince(
    fromCursor: number,
  ): readonly ConfigurationDeliveryEntry[];
  getErrors(): readonly CapturedError[];
  setWorkspaceConfiguration(response: unknown[]): void;
  close(): void;
}

function writeMessage(socket: net.Socket, message: unknown): void {
  const json = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(json, "utf-8")}\r\n\r\n`;
  socket.write(header);
  socket.write(json);
}

function parseContentLength(headerSection: string): number {
  for (const line of headerSection.split("\r\n")) {
    const match = line.match(/^Content-Length:\s*(\d+)\s*$/i);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  throw new Error("LSP message missing Content-Length");
}

function parseFrames(buffer: Buffer<ArrayBufferLike>): {
  messages: string[];
  remaining: Buffer<ArrayBufferLike>;
} {
  const messages: string[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const delimiterIndex = buffer.indexOf(HEADER_DELIMITER, offset);
    if (delimiterIndex === -1) {
      break;
    }

    const headerSection = buffer
      .subarray(offset, delimiterIndex)
      .toString("ascii");
    const contentLength = parseContentLength(headerSection);
    const bodyStart = delimiterIndex + HEADER_DELIMITER.length;
    const bodyEnd = bodyStart + contentLength;
    if (buffer.length < bodyEnd) {
      break;
    }

    messages.push(buffer.subarray(bodyStart, bodyEnd).toString("utf-8"));
    offset = bodyEnd;
  }

  return { messages, remaining: buffer.subarray(offset) };
}

function requestTimeoutError(method: string, timeoutMs: number): Error {
  return new Error(`LSP request ${method} timed out after ${timeoutMs}ms`);
}

function notificationTimeoutError(method: string, timeoutMs: number): Error {
  return new Error(`LSP notification ${method} timed out after ${timeoutMs}ms`);
}

function configurationResponse(
  params: unknown,
  configured: readonly unknown[],
  bySection?: Record<string, unknown>,
): {
  values: unknown[];
  requestedSections: string[];
  deliveredSections: string[];
} {
  const items =
    typeof params === "object" && params !== null && "items" in params
      ? (params as { items?: unknown[] }).items
      : undefined;
  if (!Array.isArray(items)) {
    return { values: [], requestedSections: [], deliveredSections: [] };
  }
  const requestedSections: string[] = [];
  const deliveredSections: string[] = [];
  const values = items.map((item, index) => {
    const section =
      typeof item === "object" && item !== null
        ? (item as { section?: string }).section
        : undefined;
    if (typeof section === "string") {
      requestedSections.push(section);
    }
    if (bySection && typeof section === "string" && section in bySection) {
      deliveredSections.push(section);
      return bySection[section];
    }
    const fallback = configured[index] ?? null;
    if (fallback !== null && typeof section === "string") {
      deliveredSections.push(section);
    }
    return fallback;
  });
  return { values, requestedSections, deliveredSections };
}

function cloneCapturedValue<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  return structuredClone(value);
}

function paramsSize(params: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(params ?? null), "utf-8");
  } catch {
    return 0;
  }
}

function emptyCaptureState<T>(): CaptureState<T> {
  return { entries: [], totalReceived: 0, droppedCount: 0 };
}

function pushBoundedCapture<T extends { absoluteIndex: number }>(
  state: CaptureState<T>,
  entry: Omit<T, "absoluteIndex">,
  limit: number,
): number {
  const absoluteIndex = state.totalReceived;
  state.totalReceived += 1;
  state.entries.push({ ...entry, absoluteIndex } as T);
  while (state.entries.length > limit) {
    state.entries.shift();
    state.droppedCount += 1;
  }
  return absoluteIndex;
}

function retainedArrayStart<T extends { absoluteIndex: number }>(
  state: CaptureState<T>,
  fromCursor: number,
): number {
  return fromCursor < state.droppedCount ? 0 : fromCursor - state.droppedCount;
}

function entryMatchesCursor<T extends { absoluteIndex: number }>(
  state: CaptureState<T>,
  entry: T,
  fromCursor: number,
): boolean {
  return fromCursor < state.droppedCount || entry.absoluteIndex >= fromCursor;
}

export function attachLspProtocolClient(
  socket: net.Socket,
  options: LspProtocolClientOptions = {},
): LspProtocolClient {
  const defaultRequestTimeoutMs = options.defaultRequestTimeoutMs ?? 10_000;
  const notificationsPerMethod =
    options.notificationsPerMethod ?? CAPTURE_LIMITS.notificationsPerMethod;
  const serverRequestsPerMethod =
    options.serverRequestsPerMethod ?? CAPTURE_LIMITS.serverRequestsPerMethod;
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let nextId = 1;
  let closed = false;
  let workspaceConfiguration = options.workspaceConfiguration ?? [];
  const configurationBySection = options.configurationBySection ?? {};
  const configurationDeliveries =
    emptyCaptureState<ConfigurationDeliveryEntry>();

  const pendingRequests = new Map<number, PendingRequest>();
  const notificationHandlers = new Map<string, Set<NotificationHandler>>();
  const customRequestHandlers = new Map<string, RequestHandler>();
  const notificationWaits: NotificationWait[] = [];
  const capturedNotifications = new Map<
    string,
    CaptureState<NotificationEntry>
  >();
  const capturedServerRequests = new Map<
    string,
    CaptureState<ServerRequestEntry>
  >();
  const capturedErrors: CapturedError[] = [];

  const recordError = (method: string, error: unknown): void => {
    const entry: CapturedError = {
      method,
      error: error instanceof Error ? error : new Error(String(error)),
    };
    capturedErrors.push(entry);
    if (capturedErrors.length > CAPTURE_LIMITS.errors) {
      capturedErrors.shift();
    }
  };

  const notificationState = (
    method: string,
  ): CaptureState<NotificationEntry> => {
    const existing = capturedNotifications.get(method);
    if (existing) {
      return existing;
    }
    const created = emptyCaptureState<NotificationEntry>();
    capturedNotifications.set(method, created);
    return created;
  };

  const serverRequestState = (
    method: string,
  ): CaptureState<ServerRequestEntry> => {
    const existing = capturedServerRequests.get(method);
    if (existing) {
      return existing;
    }
    const created = emptyCaptureState<ServerRequestEntry>();
    capturedServerRequests.set(method, created);
    return created;
  };

  const recordNotification = (method: string, params: unknown): number => {
    const state = notificationState(method);
    return pushBoundedCapture(
      state,
      {
        params,
        receivedAtMs: Date.now(),
        size: paramsSize(params),
      },
      notificationsPerMethod,
    );
  };

  const recordServerRequest = (method: string, params: unknown): void => {
    const state = serverRequestState(method);
    pushBoundedCapture(
      state,
      {
        method,
        params,
        receivedAtMs: Date.now(),
        size: paramsSize(params),
      },
      serverRequestsPerMethod,
    );
  };

  const rejectAllPending = (error: Error): void => {
    for (const pending of pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    pendingRequests.clear();

    while (notificationWaits.length > 0) {
      const wait = notificationWaits.shift();
      if (!wait) {
        continue;
      }
      clearTimeout(wait.timer);
      wait.reject(error);
    }
  };

  const detachListeners = (): void => {
    socket.removeListener("data", onData);
    socket.removeListener("error", onSocketError);
    socket.removeListener("close", onSocketClose);
  };

  const settleClosed = (error: Error): void => {
    if (closed) {
      return;
    }
    closed = true;
    rejectAllPending(error);
    notificationHandlers.clear();
    customRequestHandlers.clear();
  };

  const fatalProtocolError = (error: Error): void => {
    detachListeners();
    if (!socket.destroyed) {
      socket.destroy();
    }
    settleClosed(error);
  };

  const canWrite = (): boolean => !closed && !socket.destroyed;

  const waitMatchesIndex = (
    state: CaptureState<NotificationEntry>,
    wait: NotificationWait,
    absoluteIndex: number,
  ): boolean => {
    return (
      wait.fromIndex < state.droppedCount || absoluteIndex >= wait.fromIndex
    );
  };

  const resolveMatchingWaits = (
    method: string,
    params: unknown,
    absoluteIndex: number,
  ): void => {
    const state = notificationState(method);
    for (
      let waitIndex = notificationWaits.length - 1;
      waitIndex >= 0;
      waitIndex -= 1
    ) {
      const wait = notificationWaits[waitIndex];
      if (
        wait.method !== method ||
        !waitMatchesIndex(state, wait, absoluteIndex)
      ) {
        continue;
      }
      try {
        if (!wait.predicate(params)) {
          continue;
        }
      } catch (error) {
        notificationWaits.splice(waitIndex, 1);
        clearTimeout(wait.timer);
        recordError(wait.method, error);
        wait.reject(error instanceof Error ? error : new Error(String(error)));
        continue;
      }
      notificationWaits.splice(waitIndex, 1);
      clearTimeout(wait.timer);
      wait.resolve(params);
    }
  };

  const dispatchNotification = (method: string, params: unknown): void => {
    const absoluteIndex = recordNotification(method, params);
    const handlers = notificationHandlers.get(method);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(params);
        } catch (error) {
          recordError(method, error);
        }
      }
    }
    resolveMatchingWaits(method, params, absoluteIndex);
  };

  const builtinHandler = (method: string): RequestHandler | undefined => {
    if (method === "window/workDoneProgress/create") {
      return () => null;
    }
    if (method === "client/registerCapability") {
      return () => null;
    }
    if (method === "workspace/configuration") {
      return (params) => {
        const response = configurationResponse(
          params,
          workspaceConfiguration,
          configurationBySection,
        );
        pushBoundedCapture(
          configurationDeliveries,
          {
            requestedSections: response.requestedSections,
            deliveredSections: response.deliveredSections,
          },
          CAPTURE_LIMITS.serverRequestsPerMethod,
        );
        return response.values;
      };
    }
    return undefined;
  };

  const handleServerRequest = async (
    message: JsonRpcServerRequest,
  ): Promise<void> => {
    recordServerRequest(message.method, message.params);
    const handler =
      customRequestHandlers.get(message.method) ??
      builtinHandler(message.method);
    if (!handler) {
      recordError(
        message.method,
        new Error(`Unhandled server request: ${message.method}`),
      );
      if (canWrite()) {
        writeMessage(socket, {
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32603,
            message: `Unhandled server request: ${message.method}`,
          },
        });
      }
      return;
    }
    try {
      const result = await handler(message.params);
      if (canWrite()) {
        writeMessage(socket, {
          jsonrpc: "2.0",
          id: message.id,
          result: result ?? null,
        });
      }
    } catch (error) {
      if (!canWrite()) {
        return;
      }
      const detail = error instanceof Error ? error.message : String(error);
      writeMessage(socket, {
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32603, message: detail },
      });
    }
  };

  const handleMessage = (json: string): void => {
    if (closed) {
      return;
    }

    let message: Record<string, unknown>;
    try {
      message = JSON.parse(json) as Record<string, unknown>;
    } catch {
      fatalProtocolError(new Error("LSP message contains invalid JSON"));
      return;
    }

    if (typeof message.method === "string") {
      if (message.id !== undefined) {
        void handleServerRequest(message as unknown as JsonRpcServerRequest);
        return;
      }
      dispatchNotification(message.method, message.params);
      return;
    }

    if (typeof message.id !== "number") {
      return;
    }

    const pending = pendingRequests.get(message.id);
    if (!pending) {
      return;
    }

    pendingRequests.delete(message.id);
    clearTimeout(pending.timer);

    const response = message as unknown as JsonRpcResponse;
    if (response.error) {
      pending.reject(
        new LspRequestError(
          pending.method,
          response.error.code,
          response.error.message,
          response.error.data,
        ),
      );
      return;
    }
    pending.resolve(response.result);
  };

  const onData = (chunk: Buffer): void => {
    if (closed) {
      return;
    }
    buffer = Buffer.concat([buffer, chunk]);
    try {
      const parsed = parseFrames(buffer);
      buffer = parsed.remaining;
      for (const json of parsed.messages) {
        if (closed) {
          break;
        }
        handleMessage(json);
      }
    } catch (error) {
      fatalProtocolError(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  };

  const onSocketError = (error: Error): void => {
    detachListeners();
    if (!socket.destroyed) {
      socket.destroy();
    }
    settleClosed(error);
  };

  const onSocketClose = (): void => {
    if (closed) {
      return;
    }
    detachListeners();
    settleClosed(new Error("LSP connection closed"));
  };

  socket.on("data", onData);
  socket.on("error", onSocketError);
  socket.on("close", onSocketClose);

  const scanRetainedNotifications = (
    method: string,
    fromIndex: number,
    predicate: (params: unknown) => boolean,
  ): unknown | undefined => {
    const state = notificationState(method);
    const scanFrom = retainedArrayStart(state, fromIndex);
    for (let index = scanFrom; index < state.entries.length; index += 1) {
      const entry = state.entries[index];
      if (!entryMatchesCursor(state, entry, fromIndex)) {
        continue;
      }
      if (predicate(entry.params)) {
        return entry.params;
      }
    }
    return undefined;
  };

  const cloneNotificationEntries = (
    state: CaptureState<NotificationEntry>,
  ): readonly NotificationEntry[] => {
    return state.entries.map((entry) => ({
      params: cloneCapturedValue(entry.params),
      receivedAtMs: entry.receivedAtMs,
      size: entry.size,
      absoluteIndex: entry.absoluteIndex,
    }));
  };

  const cloneServerRequestEntries = (
    state: CaptureState<ServerRequestEntry>,
  ): readonly ServerRequestEntry[] => {
    return state.entries.map((entry) => ({
      method: entry.method,
      params: cloneCapturedValue(entry.params),
      receivedAtMs: entry.receivedAtMs,
      size: entry.size,
      absoluteIndex: entry.absoluteIndex,
    }));
  };

  const entriesSince = <T extends { absoluteIndex: number }>(
    state: CaptureState<T>,
    fromCursor: number,
  ): readonly T[] => {
    const scanFrom = retainedArrayStart(state, fromCursor);
    return state.entries
      .slice(scanFrom)
      .filter((entry) => entryMatchesCursor(state, entry, fromCursor));
  };

  return {
    request<T>(
      method: string,
      params: unknown,
      timeoutMs = defaultRequestTimeoutMs,
    ): Promise<T> {
      if (closed) {
        return Promise.reject(new Error("LSP connection closed"));
      }

      const id = nextId;
      nextId += 1;

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingRequests.delete(id);
          reject(requestTimeoutError(method, timeoutMs));
        }, timeoutMs);

        pendingRequests.set(id, {
          method,
          resolve: (value) => resolve(value as T),
          reject,
          timer,
        });

        writeMessage(socket, request);
      });
    },

    notify(method: string, params?: unknown): void {
      if (closed) {
        throw new Error("LSP connection closed");
      }
      const notification: JsonRpcNotification = {
        jsonrpc: "2.0",
        method,
        params,
      };
      writeMessage(socket, notification);
    },

    onNotification(method: string, handler: NotificationHandler): Disposable {
      const handlers = notificationHandlers.get(method) ?? new Set();
      handlers.add(handler);
      notificationHandlers.set(method, handlers);
      return {
        dispose() {
          handlers.delete(handler);
          if (handlers.size === 0) {
            notificationHandlers.delete(method);
          }
        },
      };
    },

    onRequest(method: string, handler: RequestHandler): Disposable {
      customRequestHandlers.set(method, handler);
      return {
        dispose() {
          if (customRequestHandlers.get(method) === handler) {
            customRequestHandlers.delete(method);
          }
        },
      };
    },

    waitForNotification(
      method: string,
      predicate: (params: unknown) => boolean,
      timeoutMs: number,
      fromIndex = 0,
    ): Promise<unknown> {
      if (closed) {
        return Promise.reject(new Error("LSP connection closed"));
      }

      try {
        const matched = scanRetainedNotifications(method, fromIndex, predicate);
        if (matched !== undefined) {
          return Promise.resolve(matched);
        }
      } catch (error) {
        recordError(method, error);
        return Promise.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      }

      return new Promise((resolve, reject) => {
        const wait: NotificationWait = {
          method,
          fromIndex,
          predicate,
          resolve,
          reject,
          timer: setTimeout(() => {
            const index = notificationWaits.indexOf(wait);
            if (index >= 0) {
              notificationWaits.splice(index, 1);
            }
            reject(notificationTimeoutError(method, timeoutMs));
          }, timeoutMs),
        };
        notificationWaits.push(wait);
      });
    },

    notificationCount(method: string): number {
      return notificationState(method).totalReceived;
    },

    serverRequestCount(method: string): number {
      return serverRequestState(method).totalReceived;
    },

    getNotifications(method: string): readonly unknown[] {
      return cloneNotificationEntries(notificationState(method)).map(
        (entry) => entry.params,
      );
    },

    getNotificationsSince(
      method: string,
      fromCursor: number,
    ): readonly unknown[] {
      return entriesSince(notificationState(method), fromCursor).map((entry) =>
        cloneCapturedValue(entry.params),
      );
    },

    getNotificationEntries(method: string): readonly NotificationEntry[] {
      return cloneNotificationEntries(notificationState(method));
    },

    getServerRequests(method: string): readonly ServerRequestEntry[] {
      return cloneServerRequestEntries(serverRequestState(method));
    },

    getServerRequestsSince(
      method: string,
      fromCursor: number,
    ): readonly ServerRequestEntry[] {
      return entriesSince(serverRequestState(method), fromCursor).map(
        (entry) => ({
          method: entry.method,
          params: cloneCapturedValue(entry.params),
          receivedAtMs: entry.receivedAtMs,
          size: entry.size,
          absoluteIndex: entry.absoluteIndex,
        }),
      );
    },

    configurationDeliveryCount(): number {
      return configurationDeliveries.totalReceived;
    },

    getConfigurationDeliveriesSince(
      fromCursor: number,
    ): readonly ConfigurationDeliveryEntry[] {
      return entriesSince(configurationDeliveries, fromCursor).map((entry) => ({
        requestedSections: [...entry.requestedSections],
        deliveredSections: [...entry.deliveredSections],
        absoluteIndex: entry.absoluteIndex,
      }));
    },

    getErrors(): readonly CapturedError[] {
      return capturedErrors.map((entry) => ({
        method: entry.method,
        error: entry.error,
      }));
    },

    setWorkspaceConfiguration(response: unknown[]): void {
      workspaceConfiguration = response;
    },

    close(): void {
      if (closed) {
        return;
      }
      detachListeners();
      settleClosed(new Error("LSP connection closed"));
      if (!socket.destroyed) {
        socket.destroy();
      }
    },
  };
}
