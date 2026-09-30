import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_STATIC_ANALYSIS_MODE,
  parseStaticAnalysisMode,
  StaticAnalysisMode,
} from "../../core/project";
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
  it("defaults to project", () => {
    expect(DEFAULT_STATIC_ANALYSIS_MODE).toBe("project");
  });

  it.each([
    ["project", "project"],
    ["off", "off"],
    ["baseline", "baseline"],
    ["strict", "strict"],
    [undefined, "project"],
    ["not-a-mode", "project"],
    [3, "project"],
    [null, "project"],
  ] as const)("parses %s as %s", (raw, expected) => {
    expect(parseStaticAnalysisMode(raw)).toBe(expected);
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
        ([key]) => key === `${CONFIGURATION_SECTION}.staticAnalysis`,
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
