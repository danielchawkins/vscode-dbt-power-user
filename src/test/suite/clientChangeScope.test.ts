import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "vscode";
import { onClientChange } from "../../projects/clients/clientChange";

/*
 * `pool.onDidChangeClients` fires for the whole pool. A replacement in one project must not reach the listener of
 * another project, because each listener refetches its own project's server graph.
 */

describe("onClientChange", () => {
  it.fails("does not fire for a client replaced in another project", () => {
    const clients = new EventEmitter<void>();
    const stateA = new EventEmitter<void>();
    const clientA = { onDidChangeState: stateA.event };
    const byRoot = new Map<string, unknown>([
      ["/a", clientA],
      ["/b", { onDidChangeState: vi.fn() }],
    ]);
    const pool = {
      get: (project: { root: string }) => byRoot.get(project.root),
      onDidChangeClients: clients.event,
    };
    const listener = vi.fn();
    onClientChange(pool as never, { root: "/a" } as never)(listener);

    byRoot.set("/b", { onDidChangeState: vi.fn() });
    clients.fire();
    expect(listener).not.toHaveBeenCalled();
  });

  it("fires when the project's own client changes state", () => {
    const stateA = new EventEmitter<void>();
    const pool = {
      get: () => ({ onDidChangeState: stateA.event }),
      onDidChangeClients: new EventEmitter<void>().event,
    };
    const listener = vi.fn();
    onClientChange(pool as never, { root: "/a" } as never)(listener);
    stateA.fire();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
