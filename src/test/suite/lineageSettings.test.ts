import { afterEach, describe, expect, it, vi } from "vitest";
import { workspace } from "vscode";
import { readLineageSettings } from "../../features/lineage/lineageSettings";

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
