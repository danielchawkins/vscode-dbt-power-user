import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";
import {
  affectsFusionLaunchConfiguration,
  fusionLogLevelArgument,
  parseTraceServerLevel,
  TRACE_SERVER_LEVELS,
  TRACE_SERVER_SETTING,
} from "../../lsp/fusionClientSettings";
import { CONFIGURATION_SECTION } from "../../projects/projectConfiguration";
import { esmDirname } from "../esmDirname";

const repositoryRoot = path.resolve(esmDirname(import.meta.url), "../../..");

describe("fusion trace settings", () => {
  it("matches the package manifest for traceServer", () => {
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
        ([key]) => key === `${CONFIGURATION_SECTION}.${TRACE_SERVER_SETTING}`,
      )?.[1];

    expect(property).toMatchObject({
      enum: [...TRACE_SERVER_LEVELS],
      default: "off",
      scope: "resource",
    });
    expect(JSON.stringify(property)).not.toContain("protocol");
  });

  it("maps traceServer to Fusion server process log level only", () => {
    expect(parseTraceServerLevel("verbose")).toBe("verbose");
    expect(parseTraceServerLevel(undefined)).toBe("off");
    expect(fusionLogLevelArgument("off")).toBeUndefined();
    expect(fusionLogLevelArgument("messages")).toBe("debug");
    expect(fusionLogLevelArgument("verbose")).toBe("trace");
  });

  it("treats traceServer changes as launch-affecting", () => {
    expect(
      affectsFusionLaunchConfiguration(
        {
          affectsConfiguration: (key: string) =>
            key === `${CONFIGURATION_SECTION}.${TRACE_SERVER_SETTING}`,
        } as any,
        { fsPath: "/workspace/general" } as any,
      ),
    ).toBe(true);
  });
});
