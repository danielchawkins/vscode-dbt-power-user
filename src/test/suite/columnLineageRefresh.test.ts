import { describe, expect, it, jest } from "@jest/globals";
import { LineageRead } from "../../fusion/columnLineage";
import { SchemaOriginStatus } from "../../fusion/schemaOrigin";
import {
  ColumnLineageRefresh,
  RefreshableProject,
  SAVE_DEBOUNCE_MS,
} from "../../services/columnLineageRefresh";

function project(
  origin: SchemaOriginStatus["kind"] = "local",
  root = "/p",
  lineage: LineageRead = { kind: "edges", edges: [] },
): RefreshableProject & {
  compileColumnLineage: jest.Mock;
  readColumnLineage: jest.Mock;
} {
  const status = (
    origin === "untypedSources"
      ? { kind: origin, missing: [] }
      : origin === "unsupportedFusion"
        ? { kind: origin, version: "2.0.5" }
        : { kind: origin }
  ) as SchemaOriginStatus;
  return {
    projectRoot: { fsPath: root },
    schemaOriginStatus: () => status,
    compileColumnLineage: jest.fn(
      (
        _selectors: readonly string[],
        _env: Record<string, string>,
        signal?: AbortSignal,
      ) =>
        new Promise((resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
          setTimeout(
            () =>
              resolve({ stdout: "", stderr: "", fullOutput: "", exitCode: 0 }),
            10,
          );
        }),
    ) as any,
    modelsWithColumns: (models: readonly string[]) =>
      models.map((model) => `model.p.${model}`),
    readColumnLineage: jest.fn(() => Promise.resolve(lineage)) as any,
  };
}

describe("ColumnLineageRefresh", () => {
  it("always selects +<model> and sets local origin only for a local project", async () => {
    jest.useFakeTimers();
    const refresh = new ColumnLineageRefresh();
    const local = project("local");
    const remote = project("noHook", "/q");

    const a = refresh.refreshModel(local, ["order_totals"]);
    const b = refresh.refreshModel(remote, ["order_totals"]);
    await jest.advanceTimersByTimeAsync(20);

    expect(await a).toMatchObject({
      kind: "completed",
      selectors: ["+order_totals"],
    });
    expect(await b).toMatchObject({ kind: "completed" });
    expect(local.compileColumnLineage.mock.calls[0].slice(0, 2)).toEqual([
      ["+order_totals"],
      { FUSION_POWER_USER_SCHEMA_ORIGIN: "local" },
    ]);
    expect(remote.compileColumnLineage.mock.calls[0].slice(0, 2)).toEqual([
      ["+order_totals"],
      {},
    ]);
    jest.useRealTimers();
  });

  it("passes no selector for a project refresh", async () => {
    jest.useFakeTimers();
    const refresh = new ColumnLineageRefresh();
    const p = project();
    const run = refresh.refreshProject(p);
    await jest.advanceTimersByTimeAsync(20);
    await run;
    expect(p.compileColumnLineage.mock.calls[0][0]).toEqual([]);
    jest.useRealTimers();
  });

  it("aborts the older run when a newer one starts for the same project", async () => {
    jest.useFakeTimers();
    const refresh = new ColumnLineageRefresh();
    const p = project();
    const first = refresh.refreshModel(p, ["a"]);
    const second = refresh.refreshModel(p, ["b"]);
    await jest.advanceTimersByTimeAsync(20);

    expect(await first).toEqual({ kind: "aborted" });
    expect(await second).toMatchObject({
      kind: "completed",
      selectors: ["+b"],
    });
    jest.useRealTimers();
  });

  it("debounces saves and coalesces the models saved in the window", async () => {
    jest.useFakeTimers();
    const refresh = new ColumnLineageRefresh();
    const p = project();

    expect(refresh.onModelSaved(p, "b", "project")).toBe(true);
    await jest.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 100);
    refresh.onModelSaved(p, "a", "strict");
    await jest.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 100);
    expect(p.compileColumnLineage).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(200);
    expect(p.compileColumnLineage).toHaveBeenCalledTimes(1);
    expect(p.compileColumnLineage.mock.calls[0][0]).toEqual(["+a", "+b"]);
    jest.useRealTimers();
  });

  it.each([
    ["baseline mode", "local", "baseline"],
    ["off mode", "local", "off"],
    ["remote origin", "noHook", "project"],
    ["untyped sources", "untypedSources", "strict"],
    ["old Fusion", "unsupportedFusion", "project"],
  ] as const)("does nothing on save with %s", (_, origin, mode) => {
    jest.useFakeTimers();
    const refresh = new ColumnLineageRefresh();
    const p = project(origin);
    expect(refresh.onModelSaved(p, "a", mode)).toBe(false);
    jest.advanceTimersByTime(SAVE_DEBOUNCE_MS * 2);
    expect(p.compileColumnLineage).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it("reports start and end to the listener", async () => {
    jest.useFakeTimers();
    const listener = { onStart: jest.fn(), onEnd: jest.fn() };
    const refresh = new ColumnLineageRefresh(listener);
    const p = project();
    const run = refresh.refreshModel(p, ["a"]);
    expect(listener.onStart).toHaveBeenCalledWith(p, ["+a"]);
    await jest.advanceTimersByTimeAsync(20);
    await run;
    expect(listener.onEnd).toHaveBeenCalledWith(
      p,
      expect.objectContaining({ kind: "completed" }),
    );
    jest.useRealTimers();
  });
});

describe("modelForFile", () => {
  it("matches the manifest's absolute model path", async () => {
    const { modelForFile } =
      await import("../../services/columnLineageRefreshController");
    const nodes = [
      { resource_type: "seed", path: "/p/seeds/a.csv", name: "a" },
      { resource_type: "model", path: "/p/models/orders.sql", name: "orders" },
      {
        resource_type: "model",
        path: "/pkg/models/orders.sql",
        name: "pkg_orders",
      },
    ];
    const project = {
      getMetadataSnapshot: () => ({ nodeMetaMap: { nodes: () => nodes } }),
    } as any;

    expect(modelForFile(project, "/p/models/orders.sql")).toBe("orders");
    expect(modelForFile(project, "/p/models/missing.sql")).toBeUndefined();
    expect(
      modelForFile({ getMetadataSnapshot: () => undefined } as any, "/x.sql"),
    ).toBeUndefined();
  });
});

describe("ColumnLineageRefresh fall-back detection", () => {
  it("reports emptyAfterStrict when the view has no lineage for a model with columns", async () => {
    jest.useFakeTimers();
    const refresh = new ColumnLineageRefresh();
    const p = project("local", "/p", { kind: "empty" });
    const run = refresh.refreshModel(p, ["order_totals"]);
    await jest.advanceTimersByTimeAsync(20);

    expect(await run).toMatchObject({
      compile: { kind: "strictUnavailable", signal: "emptyAfterStrict" },
    });
    expect(p.readColumnLineage.mock.calls[0].slice(0, 2)).toEqual([
      ["model.p.order_totals"],
      "upstream",
    ]);
    jest.useRealTimers();
  });

  it("keeps analyzed when the view has lineage", async () => {
    jest.useFakeTimers();
    const refresh = new ColumnLineageRefresh();
    const p = project("local", "/p", {
      kind: "edges",
      edges: [
        {
          parent: { uniqueId: "model.p.a", column: "x" },
          child: { uniqueId: "model.p.order_totals", column: "x" },
          evolution: "copy",
        },
      ],
    });
    const run = refresh.refreshModel(p, ["order_totals"]);
    await jest.advanceTimersByTimeAsync(20);
    expect(await run).toMatchObject({ compile: { kind: "analyzed" } });
    jest.useRealTimers();
  });

  it("does not read the view after a project compile", async () => {
    jest.useFakeTimers();
    const refresh = new ColumnLineageRefresh();
    const p = project("local", "/p", { kind: "empty" });
    const run = refresh.refreshProject(p);
    await jest.advanceTimersByTimeAsync(20);
    expect(await run).toMatchObject({ compile: { kind: "analyzed" } });
    expect(p.readColumnLineage).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
