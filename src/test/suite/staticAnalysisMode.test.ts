import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  ConfigurationChangeEvent,
  Uri,
  workspace,
  WorkspaceConfiguration,
} from "vscode";
import {
  affectsStaticAnalysisModeConfiguration,
  capabilitiesFor,
  createStaticAnalysisSelection,
  DEFAULT_STATIC_ANALYSIS_MODE,
  FusionCapability,
  parseStaticAnalysisMode,
  resolveConfiguredStaticAnalysisMode,
  resolveStaticAnalysisSelection,
  selectionAdmitsCapability,
  STATIC_ANALYSIS_MODE_SETTING,
  staticAnalysisLaunchArgument,
} from "../../fusion/staticAnalysisMode";
import { CONFIGURATION_SECTION } from "../../projects/projectConfiguration";

const STRICT_ONLY_CAPABILITIES: readonly FusionCapability[] = [
  "columnLineage",
  "columnDefinition",
  "typeDiagnostics",
  "selectStarHover",
  "columnRename",
];

describe("staticAnalysisMode", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ["off", "off"],
    ["baseline", "baseline"],
    ["strict", "strict"],
    [undefined, DEFAULT_STATIC_ANALYSIS_MODE],
  ] as const)("resolves configured mode %s as %s", (raw, expected) => {
    mockStaticAnalysisMode(raw);
    expect(resolveConfiguredStaticAnalysisMode(scopeUri())).toBe(expected);
  });

  it("defaults invalid raw values to baseline", () => {
    expect(parseStaticAnalysisMode("not-a-mode")).toBe("baseline");
    expect(parseStaticAnalysisMode(3)).toBe("baseline");
    expect(parseStaticAnalysisMode(null)).toBe("baseline");
  });

  it("starts with effective unknown", () => {
    expect(createStaticAnalysisSelection("strict")).toEqual({
      configured: "strict",
      effective: "unknown",
    });
    expect(resolveStaticAnalysisSelection(scopeUri())).toEqual({
      configured: DEFAULT_STATIC_ANALYSIS_MODE,
      effective: "unknown",
    });
  });

  it("uses configured mode for the launch argument", () => {
    const selection = {
      configured: "off" as const,
      effective: "strict" as const,
    };

    expect(staticAnalysisLaunchArgument(selection)).toBe("off");
    expect(
      staticAnalysisLaunchArgument({
        configured: "baseline",
        effective: "unknown",
      }),
    ).toBe("baseline");
  });

  it("matches the D5 capability matrix for known effective modes", () => {
    expect([...capabilitiesFor("off")]).toEqual([]);
    expect([...capabilitiesFor("baseline")]).toEqual([]);
    expect([...capabilitiesFor("strict")]).toEqual([
      ...STRICT_ONLY_CAPABILITIES,
    ]);
  });

  it("returns fresh strict capability sets", () => {
    const first = capabilitiesFor("strict");
    const second = capabilitiesFor("strict");

    expect(first).not.toBe(second);
    (first as Set<FusionCapability>).delete("columnLineage");
    expect([...second]).toEqual([...STRICT_ONLY_CAPABILITIES]);
  });

  it("admits no strict-only capability while effective is unknown", () => {
    const selection = createStaticAnalysisSelection("strict");

    for (const capability of STRICT_ONLY_CAPABILITIES) {
      expect(selectionAdmitsCapability(selection, capability)).toBe(false);
    }
  });

  it("delegates to capabilitiesFor once effective is known", () => {
    expect(
      selectionAdmitsCapability(
        { configured: "baseline", effective: "strict" },
        "columnLineage",
      ),
    ).toBe(true);
    expect(
      selectionAdmitsCapability(
        { configured: "strict", effective: "baseline" },
        "columnLineage",
      ),
    ).toBe(false);
  });

  it("delegates configuration changes to affectsConfiguration", () => {
    const scope = scopeUri();
    const affectsConfiguration = jest.fn().mockReturnValue(true);
    const event = { affectsConfiguration } as ConfigurationChangeEvent;

    expect(affectsStaticAnalysisModeConfiguration(event, scope)).toBe(true);
    expect(affectsConfiguration).toHaveBeenCalledWith(
      `${CONFIGURATION_SECTION}.${STATIC_ANALYSIS_MODE_SETTING}`,
      scope,
    );
  });

  it("does not model login or fallback semantics", () => {
    const selection = createStaticAnalysisSelection("baseline");

    expect(selection).not.toHaveProperty("fellBack");
    expect(Object.keys(selection).sort()).toEqual(["configured", "effective"]);
  });
});

function scopeUri(): Uri {
  return Uri.file("/workspace/project");
}

function mockStaticAnalysisMode(value: unknown): void {
  jest
    .spyOn(workspace, "getConfiguration")
    .mockReturnValue(configuration(value));
}

function configuration(value: unknown): WorkspaceConfiguration {
  return {
    get: (key: string, fallback: unknown) =>
      key === STATIC_ANALYSIS_MODE_SETTING ? value : fallback,
  } as WorkspaceConfiguration;
}
