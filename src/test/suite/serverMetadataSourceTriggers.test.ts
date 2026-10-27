import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "vscode";
import { FusionCommandError } from "../../core/lsp";
import type { FusionCommands } from "../../fusion/fusionCommands";
import { ServerMetadataSource } from "../../metadata/serverMetadataSource";

/*
 * Refresh triggers of the Server Producer. Each `it.fails` is a behaviour the next change makes true; that change
 * flips it to `it`.
 *
 * A dbt.listNodes makes the server run a Parse and then a full background compile, and a request cancels a running
 * background compile. The server compiles a source change itself, so the graph is fetched on that compile report.
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
  const sourceChanged = new EventEmitter<void>();
  const clientChanged = new EventEmitter<void>();
  const lsp = {
    state: "running",
    listNodes,
    getProjectInfo: vi
      .fn()
      .mockResolvedValue({ adapterType: "duckdb", projectName: "p" }),
  } as unknown as FusionCommands;
  const source = new ServerMetadataSource({
    lsp,
    projectName: () => "p",
    triggers: {
      compileComplete: compiled.event,
      sourceChanged: sourceChanged.event,
      clientChanged: clientChanged.event,
    },
    log: { debug: vi.fn(), warn: vi.fn() },
  });
  return { source, compiled, sourceChanged, listNodes };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("ServerMetadataSource triggers", () => {
  it("a source change waits for the server's compile report before it asks for the graph", async () => {
    const { compiled, sourceChanged, listNodes } = setup();
    compiled.fire();
    await tick();
    expect(listNodes).toHaveBeenCalledTimes(1);

    sourceChanged.fire();
    await tick();
    // Today the file event itself sends a listNodes, which cancels the server's compile of the same change.
    expect(listNodes).toHaveBeenCalledTimes(1);

    compiled.fire();
    await tick();
    expect(listNodes).toHaveBeenCalledTimes(2);
  });

  it.fails("a failed fetch is not retried by the compile reports its own request causes", async () => {
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
    // Today the report re-arms the fetch (2 calls), which causes another Parse and background compile, and so on.
    expect(calls).toHaveBeenCalledTimes(1);
  });
});
