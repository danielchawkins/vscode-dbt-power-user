import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIGURATION_SECTION } from "../../settings";
import { esmDirname } from "../esmDirname";

const repositoryRoot = path.resolve(esmDirname(import.meta.url), "../../..");
const packageJsonPath = path.join(repositoryRoot, "package.json");

function contributedConfigurationKeys(): string[] {
  const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    contributes: {
      configuration: Array<{ properties: Record<string, unknown> }>;
    };
  };
  return manifest.contributes.configuration.flatMap((section) =>
    Object.keys(section.properties),
  );
}

describe("fusionPowerUser namespace guard", () => {
  it("contributes configuration keys only under fusionPowerUser.*", () => {
    const keys = contributedConfigurationKeys();
    expect(keys.length).toBeGreaterThan(0);
    expect(
      keys.every((key) => key.startsWith(`${CONFIGURATION_SECTION}.`)),
    ).toBe(true);
  });
});
