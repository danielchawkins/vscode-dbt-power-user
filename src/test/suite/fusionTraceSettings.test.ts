import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseTraceServerLevel, TRACE_SERVER_LEVELS } from "../../core/project";
import { CONFIGURATION_SECTION } from "../../settings";
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
      .find(([key]) => key === `${CONFIGURATION_SECTION}.trace.server`)?.[1];

    expect(property).toMatchObject({
      enum: [...TRACE_SERVER_LEVELS],
      default: "off",
      scope: "resource",
    });
    expect(JSON.stringify(property)).not.toContain("protocol");
  });

  it("parses unknown levels as off", () => {
    expect(parseTraceServerLevel("verbose")).toBe("verbose");
    expect(parseTraceServerLevel(undefined)).toBe("off");
    expect(parseTraceServerLevel("protocol")).toBe("off");
  });
});
