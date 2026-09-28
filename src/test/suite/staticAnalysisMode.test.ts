import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";
import { Uri, workspace, WorkspaceConfiguration } from "vscode";
import {
  DEFAULT_STATIC_ANALYSIS_MODE,
  parseStaticAnalysisMode,
  resolveConfiguredStaticAnalysisMode,
  STATIC_ANALYSIS_MODE_SETTING,
  staticAnalysisLaunchArgument,
  StaticAnalysisMode,
} from "../../fusion/staticAnalysisMode";
import { CONFIGURATION_SECTION } from "../../settings";
import { esmDirname } from "../esmDirname";

const repositoryRoot = path.resolve(esmDirname(import.meta.url), "../../..");
const EXPECTED_STATIC_ANALYSIS_MODES = [
  "project",
  "off",
  "baseline",
  "strict",
] as const satisfies readonly StaticAnalysisMode[];

describe("staticAnalysisMode", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("defaults to project", () => {
    expect(DEFAULT_STATIC_ANALYSIS_MODE).toBe("project");
  });

  it.each([
    ["project", "project"],
    ["off", "off"],
    ["baseline", "baseline"],
    ["strict", "strict"],
    [undefined, "project"],
  ] as const)("resolves configured mode %s as %s", (raw, expected) => {
    mockStaticAnalysisMode(raw);
    expect(resolveConfiguredStaticAnalysisMode(scopeUri())).toBe(expected);
  });

  it("defaults invalid raw values to project", () => {
    expect(parseStaticAnalysisMode("not-a-mode")).toBe("project");
    expect(parseStaticAnalysisMode(3)).toBe("project");
    expect(parseStaticAnalysisMode(null)).toBe("project");
  });

  it("passes no launch argument for project and the mode otherwise", () => {
    expect(staticAnalysisLaunchArgument("project")).toBeUndefined();
    expect(staticAnalysisLaunchArgument("off")).toBe("off");
    expect(staticAnalysisLaunchArgument("baseline")).toBe("baseline");
    expect(staticAnalysisLaunchArgument("strict")).toBe("strict");
  });

  it("matches the package manifest for staticAnalysisMode", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
    ) as {
      contributes: {
        configuration: Array<{ properties: Record<string, unknown> }>;
      };
    };
    const property = manifest.contributes.configuration
      .flatMap((section) => Object.entries(section.properties))
      .find(
        ([key]) =>
          key === `${CONFIGURATION_SECTION}.${STATIC_ANALYSIS_MODE_SETTING}`,
      )?.[1] as { enumDescriptions?: string[] } | undefined;

    expect(property).toMatchObject({
      enum: [...EXPECTED_STATIC_ANALYSIS_MODES],
      default: DEFAULT_STATIC_ANALYSIS_MODE,
      scope: "resource",
    });
    // The server never writes column lineage (evidence README section 3).
    for (const description of property?.enumDescriptions ?? []) {
      expect(description).not.toMatch(/lineage.*column|column.*lineage/i);
    }
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
