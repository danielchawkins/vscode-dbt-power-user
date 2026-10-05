import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "vscode";
import { FusionCommandError } from "../../core/lsp";
import type { FusionCommands } from "../../fusion/fusionCommands";
import { ServerMetadataSource } from "../../metadata/serverMetadataSource";

const node = (id: string) => ({
  unique_id: id,
  name: id.split(".").pop(),
  resource_type: "model",
  package_name: "p",
  original_file_path: "models/a.sql",
  config: { materialized: "table" },
  depends_on: { nodes: [] },
});

function setup(
  listNodes = vi.fn().mockResolvedValue({ nodes: [node("model.p.a")] }),
) {
  const compiled = new EventEmitter<void>();
  const sourceChanged = new EventEmitter<void>();
  const clientChanged = new EventEmitter<void>();
  const lsp = {
    state: "running",
    listNodes,
    getProjectInfo: vi
      .fn()
      .mockResolvedValue({ adapterType: "duckdb", projectName: "p" }),
  } as unknown as FusionCommands;
  const log = { debug: vi.fn(), warn: vi.fn() };
  const source = new ServerMetadataSource(
    lsp,
    () => "p",
    {
      compileComplete: compiled.event,
      sourceChanged: sourceChanged.event,
      clientChanged: clientChanged.event,
    },
    log,
  );
  const changes = vi.fn();
  source.onDidChange(changes);
  return {
    source,
    compiled,
    sourceChanged,
    clientChanged,
    lsp: lsp as unknown as { state: string },
    listNodes,
    changes,
    log,
  };
}

describe("ServerMetadataSource", () => {
  it("asks for the package and its ancestors, and fires once for a new node set", async () => {
    const { source, compiled, listNodes, changes } = setup();
    compiled.fire();
    await source.refresh();
    expect(listNodes).toHaveBeenCalledWith(["+package:p"]);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(source.current()?.nodes.map((n) => n.uniqueId)).toEqual([
      "model.p.a",
    ]);
  });

  it("fires nothing when the node list is unchanged", async () => {
    const { source, changes } = setup();
    await source.refresh();
    await source.refresh();
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it("runs one refresh at a time and one more for calls made during it", async () => {
    let release = () => {};
    const listNodes = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => (release = () => resolve({ nodes: [] }))),
      )
      .mockResolvedValue({ nodes: [node("model.p.a")] });
    const { source } = setup(listNodes);
    const first = source.refresh();
    const second = source.refresh();
    const third = source.refresh();
    await new Promise((r) => setTimeout(r, 0));
    expect(listNodes).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second, third]);
    expect(listNodes).toHaveBeenCalledTimes(2);
  });

  it("ignores the compile report its own refresh causes, however late it arrives", async () => {
    const { source, compiled, listNodes } = setup();
    await source.refresh();
    expect(listNodes).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 1_500));
    compiled.fire();
    compiled.fire();
    await new Promise((r) => setTimeout(r, 0));
    expect(listNodes).toHaveBeenCalledTimes(1);
  });

  it("refreshes on a compile report after a source change, even just after a refresh", async () => {
    const { source, compiled, sourceChanged, listNodes } = setup();
    await source.refresh();
    compiled.fire();
    sourceChanged.fire();
    await source.refresh();
    expect(listNodes).toHaveBeenCalledTimes(3);
    compiled.fire();
    await new Promise((r) => setTimeout(r, 0));
    expect(listNodes).toHaveBeenCalledTimes(3);
  });

  it("refreshes again for a source change that arrives during a refresh", async () => {
    let release = () => {};
    const listNodes = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => (release = () => resolve({ nodes: [] }))),
      )
      .mockResolvedValue({ nodes: [node("model.p.a")] });
    const { source, sourceChanged, compiled } = setup(listNodes);
    compiled.fire();
    const first = source.refresh();
    await new Promise((r) => setTimeout(r, 0));
    sourceChanged.fire();
    release();
    await first;
    expect(listNodes).toHaveBeenCalledTimes(2);
    expect(source.current()?.nodes).toHaveLength(1);
  });

  it("empties its value when the client leaves running and refreshes when it returns", async () => {
    const { source, lsp, clientChanged, compiled, listNodes, changes } =
      setup();
    await source.refresh();
    expect(source.current()).toBeDefined();

    lsp.state = "failed";
    clientChanged.fire();
    expect(source.current()).toBeUndefined();
    expect(changes).toHaveBeenCalledTimes(2);

    lsp.state = "running";
    clientChanged.fire();
    compiled.fire();
    await new Promise((r) => setTimeout(r, 0));
    expect(listNodes).toHaveBeenCalledTimes(2);
    expect(source.current()).toBeDefined();
  });

  it("sends nothing until the server's first compile report of a client run", async () => {
    const { source, lsp, compiled, sourceChanged, clientChanged, listNodes } =
      setup();
    sourceChanged.fire();
    clientChanged.fire();
    await new Promise((r) => setTimeout(r, 0));
    expect(listNodes).not.toHaveBeenCalled();

    compiled.fire();
    await new Promise((r) => setTimeout(r, 0));
    expect(listNodes).toHaveBeenCalledTimes(1);

    lsp.state = "restarting";
    clientChanged.fire();
    lsp.state = "running";
    clientChanged.fire();
    sourceChanged.fire();
    await new Promise((r) => setTimeout(r, 0));
    expect(listNodes).toHaveBeenCalledTimes(1);
    compiled.fire();
    await new Promise((r) => setTimeout(r, 0));
    expect(listNodes).toHaveBeenCalledTimes(2);
    expect(source.current()).toBeDefined();
  });

  it("stays open to the next compile report after a failed refresh", async () => {
    const listNodes = vi
      .fn()
      .mockRejectedValueOnce(new FusionCommandError("timeout", "slow"))
      .mockResolvedValue({ nodes: [node("model.p.a")] });
    const { source, compiled } = setup(listNodes);
    await source.refresh();
    compiled.fire();
    await new Promise((r) => setTimeout(r, 0));
    await source.refresh();
    expect(source.current()).toBeDefined();
  });

  it("drops its value when the client is not running and keeps it on other failures", async () => {
    const listNodes = vi
      .fn()
      .mockResolvedValueOnce({ nodes: [node("model.p.a")] })
      .mockRejectedValueOnce(new FusionCommandError("timeout", "slow"))
      .mockRejectedValueOnce(new FusionCommandError("notRunning", "stopped"));
    const { source, changes, log } = setup(listNodes);
    await source.refresh();
    await source.refresh();
    expect(source.current()).toBeDefined();
    expect(log.warn).toHaveBeenCalledTimes(1);
    await source.refresh();
    expect(source.current()).toBeUndefined();
    expect(changes).toHaveBeenCalledTimes(2);
  });
});
