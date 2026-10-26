// Intent: refactor-scout characterization of request timing between the extension and the Fusion server.
// Each `it.fails` states the behaviour the timing refactor must deliver and fails today; the refactor turns each
// into `it`. Each plain `it` pins a current fact the refactor relies on.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CancellationToken } from "vscode";
import { FusionCommandError, REQUEST_POLICIES } from "../../core/lsp";
import type { FusionClient } from "../../fusion/fusionClient";
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

describe("Fusion request timing (characterization)", () => {
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

  it("today a timed-out request keeps the per-client queue busy, so the next one also times out", async () => {
    const ceilingMs = REQUEST_POLICIES.columns.ceilingMs;
    const { client, received } = slowServer(ceilingMs + 3_000);
    const commands = createFusionCommands(() => client);
    const request = { purpose: "columns" } as const;
    const first = commands.listNodes(["a"], request).catch((e: unknown) => e);
    const second = commands.listNodes(["b"], request).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(ceilingMs);
    expect(await first).toMatchObject({ kind: "timeout" });
    // FusionCommands released its queue at the ceiling, but FusionRequests still holds the first request, so the
    // second reaches the server only after the first answers, while its own ceiling started at the first's timeout.
    await vi.advanceTimersByTimeAsync(ceilingMs);
    expect(await second).toMatchObject({ kind: "timeout" });
    expect(received.map((r) => r.at)).toEqual([0, ceilingMs + 3_000]);
  });

  it.fails("cancels the server request when the caller gives up on it", async () => {
    const { client, received } = slowServer(8_000);
    const commands = createFusionCommands(() => client);
    const settled = commands
      .listNodes(["a"], { purpose: "columns" })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(REQUEST_POLICIES.columns.ceilingMs);
    await settled;
    expect(received[0]?.token?.isCancellationRequested).toBe(true);
  });

  it.fails("drops a queued request whose caller was superseded before it reached the server", async () => {
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
});
