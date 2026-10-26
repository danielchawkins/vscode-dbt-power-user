// Intent: request timing between the extension and the Fusion server, against a fake server that answers as slowly
// as the real one. Each test pins a behaviour the request lanes deliver.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CancellationToken } from "vscode";
import { FusionCommandError, REQUEST_POLICIES } from "../../core/lsp";
import {
  FUSION_LSP_COMMANDS,
  type FusionClient,
} from "../../fusion/fusionClient";
import { createFusionCommands } from "../../fusion/fusionCommands";
import { FusionRequests } from "../../fusion/fusionRequests";
import type { ClientHandle } from "../../fusion/lspClientSupport";

/** A server that answers each column-lineage request `answerMs` after it receives it, one at a time. */
function slowServer(answerMs: number) {
  const received: { at: number; token: CancellationToken | undefined }[] = [];
  let busyUntil = 0;
  const sendRequest = vi.fn(
    (_type: unknown, _params: unknown, token?: CancellationToken) => {
      received.push({ at: Date.now(), token });
      busyUntil = Math.max(busyUntil, Date.now()) + answerMs;
      const wait = busyUntil - Date.now();
      return new Promise((resolve) =>
        setTimeout(
          () => resolve({ nodes: [{ answeredAt: Date.now() }] }),
          wait,
        ),
      );
    },
  );
  const handle = { sendRequest } as unknown as ClientHandle;
  const requests = new FusionRequests(() => ({
    client: handle,
    state: "running",
    commandPrefix: "",
    uriConverters: undefined,
  }));
  const client = {
    state: "running",
    request: (command: string, payload: unknown, token?: CancellationToken) =>
      requests.request(command as never, payload, token),
  } as unknown as FusionClient;
  return { client, received, sendRequest };
}

describe("Fusion request timing", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Measured on finance_general (995 models) with Fusion 2.0.8: 10-12 s per column-lineage listNodes.
  it("answers a column-lineage request the server takes 11 s for", async () => {
    const { client } = slowServer(11_000);
    const commands = createFusionCommands(() => client);
    const answer = commands.listNodes(["@m", "+column:m.C+"], {
      purpose: "columnLineage",
    });
    const settled = answer.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(11_000);
    expect(await settled).toMatchObject({ nodes: [expect.anything()] });
  });

  it("a queued caller that times out is never sent, and times out at its own ceiling", async () => {
    const ceilingMs = REQUEST_POLICIES.columns.ceilingMs;
    const { client, received } = slowServer(ceilingMs + 3_000);
    const commands = createFusionCommands(() => client);
    const request = { purpose: "columns" } as const;
    const first = commands.listNodes(["a"], request).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_000);
    const settledAt = vi.fn();
    const second = commands.listNodes(["b"], request).catch((e: unknown) => {
      settledAt(Date.now());
      return e;
    });
    await vi.advanceTimersByTimeAsync(ceilingMs - 1);
    expect(await first).toMatchObject({ kind: "timeout" });
    expect(settledAt).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await second).toMatchObject({ kind: "timeout" });
    // The second ceiling runs from its call at 1 s, not from when the first request timed out.
    expect(settledAt).toHaveBeenCalledWith(1_000 + ceilingMs);
    expect(received.map((r) => r.at)).toEqual([0]);
  });

  it("cancels the server request when the caller gives up on it", async () => {
    const ceilingMs = REQUEST_POLICIES.columns.ceilingMs;
    const { client, received } = slowServer(ceilingMs + 3_000);
    const commands = createFusionCommands(() => client);
    const settled = commands
      .listNodes(["a"], { purpose: "columns" })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(ceilingMs);
    expect(await settled).toMatchObject({ kind: "timeout" });
    expect(received[0]?.token?.isCancellationRequested).toBe(true);
  });

  it("drops a queued request whose caller was superseded before it reached the server", async () => {
    const { client, sendRequest } = slowServer(8_000);
    const commands = createFusionCommands(() => client);
    let cancelled = false;
    const listeners: (() => void)[] = [];
    const token = {
      get isCancellationRequested() {
        return cancelled;
      },
      onCancellationRequested: (l: () => void) => {
        listeners.push(l);
        return { dispose: () => undefined };
      },
    } as unknown as CancellationToken;
    const request = { purpose: "columns" } as const;
    void commands.listNodes(["old-1"], request).catch(() => undefined);
    const stale = commands
      .listNodes(["old-2"], { ...request, token })
      .catch((e: unknown) => e);
    cancelled = true;
    for (const l of listeners) {
      l();
    }
    void commands.listNodes(["new"], request).catch(() => undefined);
    // The stale request must settle at once as cancelled, not wait 8 s in the queue.
    await vi.advanceTimersByTimeAsync(0);
    expect(
      await Promise.race([stale, Promise.resolve("pending")]),
    ).toMatchObject({
      kind: "cancelled",
    });
    await vi.advanceTimersByTimeAsync(16_000);
    expect(sendRequest).toHaveBeenCalledTimes(2);
  });

  // Fusion 2.0.8 answers a superseded listNodes with a result body {"error":"Operation cancelled"}, not an LSP error.
  it("classifies the server's Operation cancelled answer as cancelled", async () => {
    const commands = createFusionCommands(
      () =>
        ({
          state: "running",
          request: vi.fn().mockResolvedValue({
            error: "Operation cancelled",
            grain: "unknown",
            nodes: [],
          }),
        }) as unknown as FusionClient,
    );
    const error = await commands
      .listNodes(["a"], { purpose: "columnLineage" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FusionCommandError);
    expect(error).toMatchObject({ kind: "cancelled" });
  });

  it("FusionRequests sends a second listNodes while the first is in flight", () => {
    const sendRequest = vi.fn(() => new Promise(() => {}));
    const requests = new FusionRequests(() => ({
      client: { sendRequest } as unknown as ClientHandle,
      state: "running",
      commandPrefix: "",
      uriConverters: undefined,
    }));
    void requests.request(FUSION_LSP_COMMANDS.listNodes, ["a"]);
    void requests.request(FUSION_LSP_COMMANDS.listNodes, ["b"]);
    expect(sendRequest).toHaveBeenCalledTimes(2);
  });
});
