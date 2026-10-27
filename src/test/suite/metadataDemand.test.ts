import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "vscode";
import { MetadataDemand } from "../../projects/manifest/metadataDemand";
import { QueryManifestService } from "../../projects/project/queryManifestService";

describe("MetadataDemand", () => {
  it("is active while any consumer holds it and fires when the first appears", () => {
    const demand = new MetadataDemand();
    const appeared = vi.fn();
    demand.onDidBecomeActive(appeared);
    expect(demand.active).toBe(false);
    const a = demand.acquire();
    const b = demand.acquire();
    expect(appeared).toHaveBeenCalledTimes(1);
    a.dispose();
    expect(demand.active).toBe(true);
    b.dispose();
    expect(demand.active).toBe(false);
  });

  it("follows a visibility flag", () => {
    const demand = new MetadataDemand();
    const changed = new EventEmitter<void>();
    let visible = false;
    const follow = demand.follow(() => visible, changed.event);
    expect(demand.active).toBe(false);
    visible = true;
    changed.fire();
    expect(demand.active).toBe(true);
    visible = false;
    changed.fire();
    expect(demand.active).toBe(false);
    follow.dispose();
  });
});

describe("QueryManifestService.freshManifest", () => {
  it("awaits a stale parse before returning the manifest", async () => {
    const order: string[] = [];
    const project = {
      projectRoot: { fsPath: "/p" },
      ensureParsed: vi.fn(async () => void order.push("parsed")),
    };
    const service = new QueryManifestService(
      { get: () => project } as never,
      { debug: vi.fn() } as never,
      { current: { root: { fsPath: "/p" } } } as never,
    );
    vi.spyOn(service, "getProject").mockReturnValue(project as never);
    vi.spyOn(service, "manifestFor").mockImplementation(() => {
      order.push("read");
      return undefined;
    });
    await service.freshManifest();
    expect(order).toEqual(["parsed", "read"]);
  });
});
