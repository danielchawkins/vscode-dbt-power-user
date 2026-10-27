import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "vscode";
import { FusionCommandError } from "../../core/lsp";
import type { CompilePhase } from "../../fusion/compileSignal";
import type { FusionCommands } from "../../fusion/fusionCommands";
import { ServerMetadataSource } from "../../metadata/serverMetadataSource";
import { MetadataDemand } from "../../projects/manifest/metadataDemand";

/*
 * Refresh triggers of the Server Producer. A dbt.listNodes makes the server run a Parse and then a full background
 * compile, and a request cancels a running background compile, so the graph is fetched only when a compile report
 * says the server has the change, and not while the server is still compiling it.
 */

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
  const idle = new EventEmitter<void>();
  const sourceChanged = new EventEmitter<void>();
  const clientChanged = new EventEmitter<void>();
  const phase: { current: CompilePhase } = { current: "idle" };
  const lsp = {
    state: "running",
    get compilePhase() {
      return phase.current;
    },
    listNodes,
    getProjectInfo: vi
      .fn()
      .mockResolvedValue({ adapterType: "duckdb", projectName: "p" }),
  } as unknown as FusionCommands;
  const demand = new MetadataDemand();
  demand.acquire();
  const source = new ServerMetadataSource({
    lsp,
    projectName: () => "p",
    triggers: {
      compileComplete: compiled.event,
      compileIdle: idle.event,
      sourceChanged: sourceChanged.event,
      clientChanged: clientChanged.event,
    },
    demand,
    log: { debug: vi.fn(), warn: vi.fn() },
  });
  return { source, compiled, idle, sourceChanged, listNodes, phase };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("ServerMetadataSource triggers", () => {
  it("a source change does not send a listNodes while the server is still compiling that change", async () => {
    const { compiled, sourceChanged, listNodes, phase } = setup();
    compiled.fire();
    await tick();
    expect(listNodes).toHaveBeenCalledTimes(1);

    phase.current = "compiling";
    sourceChanged.fire();
    await tick();
    // A listNodes sent now would cancel the server's own compile of the same change.
    expect(listNodes).toHaveBeenCalledTimes(1);

    phase.current = "idle";
    compiled.fire();
    await tick();
    expect(listNodes).toHaveBeenCalledTimes(2);
  });

  it("a source change during a background compile waits for the server to go idle", async () => {
    const { compiled, idle, sourceChanged, listNodes, phase } = setup();
    compiled.fire();
    await tick();
    expect(listNodes).toHaveBeenCalledTimes(1);

    phase.current = "backgroundCompiling";
    sourceChanged.fire();
    await tick();
    expect(listNodes).toHaveBeenCalledTimes(1);

    phase.current = "idle";
    idle.fire();
    await tick();
    expect(listNodes).toHaveBeenCalledTimes(2);
  });

  it("a source change after the server's compile report fetches once, since no later report comes for it", async () => {
    const { compiled, sourceChanged, listNodes } = setup();
    compiled.fire();
    await tick();
    expect(listNodes).toHaveBeenCalledTimes(1);

    // The file event arrives about the debounce after the save, so the save's compile report has come already.
    sourceChanged.fire();
    await tick();
    expect(listNodes).toHaveBeenCalledTimes(2);
  });

  it("a failed fetch is not retried by the compile reports its own request causes", async () => {
    const listNodes = vi
      .fn()
      .mockRejectedValueOnce(new FusionCommandError("cancelled", "stopped"))
      .mockResolvedValue({ nodes: [node("model.p.a")] });
    const { compiled, listNodes: calls } = setup(listNodes);
    compiled.fire();
    await tick();
    expect(calls).toHaveBeenCalledTimes(1);

    // The Parse and background compile reports that the failed listNodes itself caused.
    compiled.fire();
    compiled.fire();
    await tick();
    expect(calls).toHaveBeenCalledTimes(1);
  });
});
