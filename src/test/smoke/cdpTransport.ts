import type { ContextSlot, DispatchedContext } from "./cdpEvaluation";
import {
  allDispatchedSlotsSettled,
  assembleEvaluationResults,
  evaluationSlot,
} from "./cdpEvaluation";

/** One entry of the CDP `/json/list` endpoint. */
export interface CdpTarget {
  type: string;
  title?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

export async function listTargets(port: string): Promise<CdpTarget[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) {
    throw new Error(`CDP target request failed: ${response.status}`);
  }
  return (await response.json()) as CdpTarget[];
}

/** Every log and console entry the target has buffered; both `enable` calls replay them before they answer. */
export function logEntries(webSocketUrl: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const texts: string[] = [];
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`CDP Log.enable timed out: ${webSocketUrl}`));
    }, 5_000);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method: "Log.enable" }));
      socket.send(JSON.stringify({ id: 2, method: "Console.enable" }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.method === "Log.entryAdded") {
        texts.push(String(message.params.entry.text));
        return;
      }
      if (message.method === "Console.messageAdded") {
        texts.push(String(message.params.message.text));
        return;
      }
      if (message.id === 2) {
        clearTimeout(timeout);
        setTimeout(() => {
          socket.close();
          resolve(texts);
        }, 300);
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error(`CDP socket failed: ${webSocketUrl}`));
    });
  });
}

export function evaluateContexts(
  webSocketUrl: string,
  expression: string,
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const pendingContextIds = new Set<number>();
    const slots = new Map<number, ContextSlot>();
    let dispatched: DispatchedContext[] = [];
    let evaluateStarted = false;
    let contextTimer: NodeJS.Timeout | undefined;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      clearTimeout(contextTimer);
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    };
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };
    const maybeComplete = () => {
      if (settled || !evaluateStarted) {
        return;
      }
      if (!allDispatchedSlotsSettled(dispatched, slots)) {
        return;
      }
      finish(() => {
        try {
          resolve(assembleEvaluationResults(dispatched, slots));
        } catch (error) {
          reject(
            error instanceof Error
              ? error
              : new Error(
                  error === undefined || error === null
                    ? "CDP evaluation assembly failed"
                    : JSON.stringify(error),
                ),
          );
        }
      });
    };
    const timeout = setTimeout(
      () =>
        finish(() =>
          reject(
            new Error(`CDP context evaluation timed out: ${webSocketUrl}`),
          ),
        ),
      5_000,
    );
    const dispatchEvaluations = () => {
      evaluateStarted = true;
      const contextIds = [...pendingContextIds];
      pendingContextIds.clear();
      if (contextIds.length === 0) {
        finish(() => resolve([]));
        return;
      }
      dispatched = contextIds.map((contextId, index) => ({
        requestId: 100 + index,
        contextId,
      }));
      for (const { requestId } of dispatched) {
        slots.set(requestId, { state: "pending" });
      }
      for (const { requestId, contextId } of dispatched) {
        socket.send(
          JSON.stringify({
            id: requestId,
            method: "Runtime.evaluate",
            params: {
              contextId,
              expression,
              awaitPromise: true,
              returnByValue: true,
            },
          }),
        );
      }
    };
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.method === "Runtime.executionContextCreated") {
        if (!evaluateStarted) {
          pendingContextIds.add(message.params.context.id);
        }
        return;
      }
      if (message.method === "Runtime.executionContextDestroyed") {
        const contextId = message.params.executionContextId as number;
        if (!evaluateStarted) {
          pendingContextIds.delete(contextId);
          return;
        }
        const entry = dispatched.find(
          ({ contextId: dispatchedId }) => dispatchedId === contextId,
        );
        if (entry && slots.get(entry.requestId)?.state === "pending") {
          slots.set(entry.requestId, { state: "destroyed" });
          maybeComplete();
        }
        return;
      }
      if (message.id === 1) {
        if (pendingContextIds.size === 0) {
          // Cursor can acknowledge Runtime.enable before reporting existing contexts.
          contextTimer = setTimeout(dispatchEvaluations, 100);
        } else {
          dispatchEvaluations();
        }
        return;
      }
      if (typeof message.id !== "number" || message.id < 100) {
        return;
      }
      slots.set(message.id, evaluationSlot(message));
      maybeComplete();
    });
    socket.addEventListener("error", () => {
      finish(() => reject(new Error(`CDP socket failed: ${webSocketUrl}`)));
    });
  });
}

/** Sends one CDP command to `webSocketUrl` and resolves with its result. */
export function sendCommand(
  webSocketUrl: string,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 5_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`CDP ${method} timed out`));
    }, timeoutMs);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method, params }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) {
        return;
      }
      clearTimeout(timeout);
      socket.close();
      if (message.error) {
        reject(
          new Error(`CDP ${method} failed: ${JSON.stringify(message.error)}`),
        );
        return;
      }
      resolve(message.result ?? {});
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error(`CDP ${method} socket failed`));
    });
  });
}
