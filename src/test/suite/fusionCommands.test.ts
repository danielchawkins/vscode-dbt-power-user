import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Uri } from "vscode";
import { FusionCommandError } from "../../core/lsp";
import { createFusionCommands } from "../../fusion/fusionCommands";
import type { FusionClient } from "../../fusion/fusionLanguageClient";

function clientWith(
  request: (...args: unknown[]) => Promise<unknown>,
  state = "running",
): FusionClient {
  return { state, request } as unknown as FusionClient;
}

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
    await expect(none.listNodes(["x"])).rejects.toMatchObject({
      kind: "notRunning",
    });
    const starting = createFusionCommands(() =>
      clientWith(vi.fn(), "starting"),
    );
    expect(starting.state).toBe("starting");
    await expect(starting.getProjectInfo()).rejects.toMatchObject({
      kind: "notRunning",
    });
  });

  it("resolves the client per call", async () => {
    let current = clientWith(vi.fn().mockResolvedValue({ nodes: [{ a: 1 }] }));
    const commands = createFusionCommands(() => current);
    expect(await commands.listNodes(["a"])).toEqual({ nodes: [{ a: 1 }] });
    current = clientWith(vi.fn().mockResolvedValue({ nodes: [] }));
    expect(await commands.listNodes(["a"])).toEqual({ nodes: [] });
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
    expect(await commands.listNodes(["a"])).toEqual({ nodes: [] });
    expect(await commands.listNodes(["a"])).toEqual({ nodes: [] });
  });

  it("maps a server error, a null listNodes result and transport errors to server errors", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ error: "empty selector list" })
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("boom"));
    const commands = createFusionCommands(() => clientWith(request));
    for (const message of ["empty selector list", /no result/, "boom"]) {
      const error = await commands.listNodes(["a"]).catch((e: unknown) => e);
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
    await expect(commands.listNodes(["a"])).rejects.toMatchObject({
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
    expect(await commands.getCurrentNode("models/a.sql")).toBeUndefined();
    expect(await commands.getCurrentNode("models/a.sql")).toEqual({
      node: { columns: {} },
    });
    expect(await commands.getProjectInfo()).toBeUndefined();
    expect(await commands.getProjectInfo()).toEqual({
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
    await expect(commands.compileFile(uri)).rejects.toMatchObject({
      kind: "server",
    });
    expect(await commands.compileFile(uri)).toEqual({
      fileUri: "file:///t/a.sql",
    });
    expect(request).toHaveBeenLastCalledWith("dbt.compileFile", [
      uri.toString(),
    ]);
  });

  it("times out after the deadline", async () => {
    const commands = createFusionCommands(
      () => clientWith(() => new Promise(() => {})),
      5_000,
    );
    const pending = commands.compileFile(Uri.file("/p/a.sql"));
    const settled = pending.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await settled).toMatchObject({ kind: "timeout" });
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
    const first = commands.listNodes(["a"]);
    const second = commands.listNodes(["b"]);
    const compile = commands.compileFile(Uri.file("/p/a.sql"));
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
    const first = commands.listNodes(["a"]).catch((e: unknown) => e);
    const second = commands.listNodes(["a"]);
    expect(await first).toBeInstanceOf(FusionCommandError);
    expect(await second).toEqual({ nodes: [] });
  });
});
