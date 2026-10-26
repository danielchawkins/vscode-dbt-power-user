import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CancellationToken } from "vscode";
import { Uri } from "vscode";
import {
  ceilingMessage,
  FusionCommandError,
  REQUEST_POLICIES,
  type RequestPurpose,
} from "../../core/lsp";
import type { FusionClient } from "../../fusion/fusionClient";
import { createFusionCommands } from "../../fusion/fusionCommands";

function clientWith(
  request: (...args: unknown[]) => Promise<unknown>,
  state = "running",
): FusionClient {
  return { state, request } as unknown as FusionClient;
}

const columnLineage = { purpose: "columnLineage" } as const;
const columns = { purpose: "columns" } as const;

describe("FusionCommands", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports notRunning without a client or when the client is not running", async () => {
    const none = createFusionCommands(() => undefined);
    expect(none.state).toBe("notRunning");
    await expect(none.listNodes(["x"], columnLineage)).rejects.toMatchObject({
      kind: "notRunning",
    });
    const starting = createFusionCommands(() =>
      clientWith(vi.fn(), "starting"),
    );
    expect(starting.state).toBe("starting");
    await expect(
      starting.getProjectInfo({ purpose: "projectInfo" }),
    ).rejects.toMatchObject({
      kind: "notRunning",
    });
  });

  it("resolves the client per call", async () => {
    let current = clientWith(vi.fn().mockResolvedValue({ nodes: [{ a: 1 }] }));
    const commands = createFusionCommands(() => current);
    expect(await commands.listNodes(["a"], columnLineage)).toEqual({
      nodes: [{ a: 1 }],
    });
    current = clientWith(vi.fn().mockResolvedValue({ nodes: [] }));
    expect(await commands.listNodes(["a"], columnLineage)).toEqual({
      nodes: [],
    });
  });

  it("maps No nodes found and lineage_query_failed to an empty result", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ error: "No nodes found" })
      .mockResolvedValueOnce({
        error: "x",
        error_kind: "lineage_query_failed",
      });
    const commands = createFusionCommands(() => clientWith(request));
    expect(await commands.listNodes(["a"], columnLineage)).toEqual({
      nodes: [],
    });
    expect(await commands.listNodes(["a"], columnLineage)).toEqual({
      nodes: [],
    });
  });

  it("maps a server error, a null listNodes result and transport errors to server errors", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ error: "empty selector list" })
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("boom"));
    const commands = createFusionCommands(() => clientWith(request));
    for (const message of ["empty selector list", /no result/, "boom"]) {
      const error = await commands
        .listNodes(["a"], columnLineage)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(FusionCommandError);
      expect(error).toMatchObject({ kind: "server" });
      expect((error as Error).message).toMatch(message);
    }
  });

  it("maps cancelled transport errors to cancelled", async () => {
    const request = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("x"), { code: -32800 }));
    const commands = createFusionCommands(() => clientWith(request));
    await expect(
      commands.listNodes(["a"], columnLineage),
    ).rejects.toMatchObject({
      kind: "cancelled",
    });
  });

  it("resolves getCurrentNode to undefined for null and getProjectInfo for an empty answer", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ node: { columns: {} } })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ adapter_type: "duckdb", project_name: "p" });
    const commands = createFusionCommands(() => clientWith(request));
    expect(
      await commands.getCurrentNode("models/a.sql", columns),
    ).toBeUndefined();
    expect(await commands.getCurrentNode("models/a.sql", columns)).toEqual({
      node: { columns: {} },
    });
    expect(
      await commands.getProjectInfo({ purpose: "projectInfo" }),
    ).toBeUndefined();
    expect(await commands.getProjectInfo({ purpose: "projectInfo" })).toEqual({
      adapterType: "duckdb",
      projectName: "p",
    });
  });

  it("rejects compileFile for a null result and returns the file the server names", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ error: null, file_uri: "file:///t/a.sql" });
    const commands = createFusionCommands(() => clientWith(request));
    const uri = Uri.file("/p/models/a.sql");
    const compiledSql = { purpose: "compiledSql" } as const;
    await expect(commands.compileFile(uri, compiledSql)).rejects.toMatchObject({
      kind: "server",
    });
    expect(await commands.compileFile(uri, compiledSql)).toEqual({
      fileUri: "file:///t/a.sql",
    });
    expect(request).toHaveBeenLastCalledWith(
      "dbt.compileFile",
      [uri.toString()],
      expect.anything(),
    );
  });

  it("times out at the purpose's ceiling, with a message that names the purpose and the ceiling", async () => {
    const commands = createFusionCommands(() =>
      clientWith(() => new Promise(() => {})),
    );
    const outcome = vi.fn();
    const settled = commands
      .listNodes(["a"], columnLineage)
      .catch((e: unknown) => {
        outcome(e);
        return e;
      });
    const { ceilingMs } = REQUEST_POLICIES.columnLineage;
    await vi.advanceTimersByTimeAsync(ceilingMs - 1);
    expect(outcome).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const error = await settled;
    expect(error).toMatchObject({
      kind: "timeout",
      message: "Column lineage did not answer within 5 min",
    });
    expect((error as Error).message).not.toMatch(/dbt\.|\bms\b/);
  });

  it("times out a compile at its purpose's ceiling", async () => {
    const commands = createFusionCommands(() =>
      clientWith(() => new Promise(() => {})),
    );
    const settled = commands
      .compileFile(Uri.file("/p/a.sql"), { purpose: "compiledSql" })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(REQUEST_POLICIES.compiledSql.ceilingMs);
    expect(await settled).toMatchObject({
      kind: "timeout",
      message: "Compiled SQL did not answer within 2 min",
    });
  });

  it("settles a request whose caller cancels while it is in flight at once, as cancelled", async () => {
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
    const request = vi.fn((..._args: unknown[]) => new Promise(() => {}));
    const commands = createFusionCommands(() => clientWith(request));
    const settled = commands
      .listNodes(["a"], { purpose: "columnLineage", token })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0);
    // The server gets the lane's own token, so one caller cannot cancel an answer others still want.
    const serverToken = request.mock.calls[0]?.[2] as CancellationToken;
    expect(serverToken.isCancellationRequested).toBe(false);
    cancelled = true;
    for (const listener of listeners) {
      listener();
    }
    expect(await settled).toMatchObject({ kind: "cancelled" });
    expect(serverToken.isCancellationRequested).toBe(true);
  });

  it("does not join a cancelled request, so a later caller is not rejected with the server's cancel", async () => {
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
    const answers: ((value: unknown) => void)[] = [];
    const rejections: ((error: unknown) => void)[] = [];
    const request = vi.fn((..._args: unknown[]) =>
      new Promise((resolve, reject) => {
        answers.push(resolve);
        rejections.push(reject);
      }),
    );
    const commands = createFusionCommands(() => clientWith(request));
    const first = commands
      .listNodes(["a"], { purpose: "columns", token })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);
    cancelled = true;
    for (const listener of listeners) {
      listener();
    }
    expect(await first).toMatchObject({ kind: "cancelled" });
    const second = commands.listNodes(["a"], { purpose: "columns" });
    await vi.advanceTimersByTimeAsync(0);
    // The server has the cancelled request, so the second caller waits for its answer and sends its own.
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[2]).toMatchObject({
      isCancellationRequested: true,
    });
    rejections[0]?.(Object.assign(new Error("Request cancelled"), { code: -32800 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(2);
    answers[1]?.({ nodes: [{ unique_id: "a" }] });
    expect(await second).toMatchObject({ nodes: [expect.anything()] });
  });

  it("rejects a request whose caller already cancelled, without sending it", async () => {
    const token = {
      isCancellationRequested: true,
      onCancellationRequested: () => ({ dispose: () => undefined }),
    } as unknown as CancellationToken;
    const request = vi.fn((..._args: unknown[]) =>
      Promise.resolve({ nodes: [] }),
    );
    const commands = createFusionCommands(() => clientWith(request));
    await expect(
      commands.listNodes(["a"], { purpose: "columnLineage", token }),
    ).rejects.toMatchObject({
      kind: "cancelled",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("gives every purpose a finite ceiling", () => {
    const purposes = Object.keys(REQUEST_POLICIES) as RequestPurpose[];
    expect(purposes.sort()).toEqual([
      "columnLineage",
      "columns",
      "compiledSql",
      "format",
      "graph",
      "projectInfo",
    ]);
    for (const purpose of purposes) {
      const { ceilingMs } = REQUEST_POLICIES[purpose];
      expect(Number.isFinite(ceilingMs) && ceilingMs > 0).toBe(true);
    }
    expect(ceilingMessage("format")).toBe("Format did not answer within 5 s");
  });

  it("sends one command per class at a time and lets classes overlap", async () => {
    const started: string[] = [];
    const release: (() => void)[] = [];
    const request = vi.fn((command: unknown) => {
      started.push(command as string);
      return new Promise((resolve) => {
        release.push(() => resolve({ nodes: [], file_uri: "file:///x" }));
      });
    });
    const commands = createFusionCommands(() => clientWith(request));
    const first = commands.listNodes(["a"], columnLineage);
    const second = commands.listNodes(["b"], columnLineage);
    const compile = commands.compileFile(Uri.file("/p/a.sql"), {
      purpose: "compiledSql",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(["dbt.listNodes", "dbt.compileFile"]);
    release[0]();
    await first;
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([
      "dbt.listNodes",
      "dbt.compileFile",
      "dbt.listNodes",
    ]);
    release[1]();
    release[2]();
    await Promise.all([second, compile]);
  });

  it("keeps the queue going after a failure", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ nodes: [] });
    const commands = createFusionCommands(() => clientWith(request));
    const first = commands
      .listNodes(["a"], columnLineage)
      .catch((e: unknown) => e);
    const second = commands.listNodes(["b"], columnLineage);
    expect(await first).toBeInstanceOf(FusionCommandError);
    expect(await second).toEqual({ nodes: [] });
  });
});
