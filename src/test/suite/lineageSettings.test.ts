import { afterEach, describe, expect, it, vi } from "vitest";
import { workspace } from "vscode";
import {
  persistLineageSettings,
  readLineageSettings,
} from "../../features/lineage/lineageSettings";

/** A global-state store holding `stored` under the lineage settings key. */
const storeWith = (stored: Record<string, unknown> | undefined) => {
  const globalState = new Map<string, unknown>([
    ["lineage.viewSettings", stored],
  ]);
  return {
    getFromGlobalState: (key: string) => globalState.get(key),
    setToGlobalState: () => undefined,
  } as Parameters<typeof readLineageSettings>[0];
};

describe("readLineageSettings connections", () => {
  it("reads a store written before connections as both when showRefs is on", () => {
    expect(readLineageSettings(storeWith({ showRefs: true })).connections).toBe(
      "both",
    );
  });

  it("reads a store written before connections as dbt when showRefs is off", () => {
    expect(
      readLineageSettings(storeWith({ showRefs: false })).connections,
    ).toBe("dbt");
  });

  it("defaults to dbt when the store holds no settings", () => {
    expect(readLineageSettings(storeWith(undefined)).connections).toBe("dbt");
  });

  it("prefers connections over a leftover showRefs", () => {
    expect(
      readLineageSettings(storeWith({ showRefs: true, connections: "dbt" }))
        .connections,
    ).toBe("dbt");
  });

  it("drops the old showRefs key from the settings it returns", () => {
    expect(
      readLineageSettings(storeWith({ showRefs: true })),
    ).not.toHaveProperty("showRefs");
  });
});

describe("readLineageSettings layerColors", () => {
  const defaultConfiguration = workspace.getConfiguration();
  afterEach(() => {
    vi.mocked(workspace.getConfiguration).mockReturnValue(defaultConfiguration);
  });

  const withLayerColors = (value: unknown) =>
    vi.mocked(workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string) =>
        key === "lineage.layerColors" ? value : undefined,
      ),
      has: vi.fn(),
      inspect: vi.fn(),
      update: vi.fn(),
    } as never);

  it("passes the string entries through for the panel to check", () => {
    withLayerColors({ staging: "charts.red", marts: "#00ff00" });
    expect(readLineageSettings(storeWith(undefined)).layerColors).toEqual({
      staging: "charts.red",
      marts: "#00ff00",
    });
  });

  it("drops empty and non-string entries, and reads a non-object as empty", () => {
    withLayerColors({ staging: "", marts: 3, "": "charts.red" });
    expect(readLineageSettings(storeWith(undefined)).layerColors).toEqual({});
    withLayerColors("charts.red");
    expect(readLineageSettings(storeWith(undefined)).layerColors).toEqual({});
  });
});

describe("persistLineageSettings edgeOpacity", () => {
  /** Saves `edgeOpacity` and returns what the store was given for it; `undefined` when nothing was written. */
  const savedOpacity = async (edgeOpacity: number) => {
    const setToGlobalState = vi.fn();
    const store = {
      getFromGlobalState: () => undefined,
      setToGlobalState,
    } as unknown as Parameters<typeof persistLineageSettings>[0];
    await persistLineageSettings(store, { edgeOpacity });
    const [, saved] = setToGlobalState.mock.calls[0] ?? [];
    return (saved as { edgeOpacity?: number } | undefined)?.edgeOpacity;
  };

  it("clamps an opacity below 0.1 up to 0.1 and one above 1 down to 1", async () => {
    expect(await savedOpacity(0.02)).toBe(0.1);
    expect(await savedOpacity(3)).toBe(1);
  });

  it("keeps an opacity inside 0.1..1 as it is", async () => {
    expect(await savedOpacity(0.5)).toBe(0.5);
  });

  it("drops a non-finite opacity, so no value is written for it", async () => {
    expect(await savedOpacity(Number.NaN)).toBeUndefined();
    expect(await savedOpacity(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});

describe("lineage view settings: clamped on read and on write", () => {
  it("reads a stored view with out-of-range values clamped and an unknown mode dropped", () => {
    const settings = readLineageSettings(
      storeWith({
        viewMode: "bogus",
        upstreamDepth: 99,
        downstreamDepth: -2,
        cardBudget: 5000,
      }),
    );
    expect(settings).not.toHaveProperty("viewMode");
    expect(settings.upstreamDepth).toBe(10);
    expect(settings.downstreamDepth).toBe(0);
    expect(settings.cardBudget).toBe(1000);
  });

  it("keeps a valid stored mode and rounds depths", () => {
    const settings = readLineageSettings(
      storeWith({ viewMode: "neighbourhood", upstreamDepth: 2.4 }),
    );
    expect(settings.viewMode).toBe("neighbourhood");
    expect(settings.upstreamDepth).toBe(2);
  });

  it("writes clamped view settings to global state and drops a non-finite budget", async () => {
    const written: Record<string, unknown>[] = [];
    const store = {
      getFromGlobalState: () => undefined,
      setToGlobalState: (_key: string, value: Record<string, unknown>) =>
        written.push(value),
    } as Parameters<typeof persistLineageSettings>[0];
    await persistLineageSettings(store, {
      viewMode: "whole",
      upstreamDepth: 50,
      downstreamDepth: 1,
      cardBudget: 0,
    });
    expect(written[0]).toMatchObject({
      viewMode: "whole",
      upstreamDepth: 10,
      downstreamDepth: 1,
      cardBudget: 1,
    });
    await persistLineageSettings(store, {
      viewMode: "bogus" as never,
      cardBudget: Number.NaN,
    });
    // Every value was invalid, so nothing is written.
    expect(written).toHaveLength(1);
  });
});
