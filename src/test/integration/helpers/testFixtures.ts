import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  judgeFusionVersion,
  parseFusionVersion,
} from "../../../fusion/fusionVersion";

/**
 * Resolves the extension repository root from either source or compiled tests.
 */
export function getExtensionRoot(): string {
  let current = __dirname;

  while (!fs.existsSync(path.join(current, "src", "test", "fixtures"))) {
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error("Could not find src/test/fixtures");
    }
    current = parent;
  }

  return current;
}

/**
 * Resolves a fixture path relative to extension root.
 * Example: "single-project" → "/repo/src/test/fixtures/single-project"
 */
export function fixturePath(fixtureName: string): string {
  const extensionRoot = getExtensionRoot();
  return path.join(extensionRoot, "src", "test", "fixtures", fixtureName);
}

/**
 * Checks whether dbt on PATH is Fusion 2.0.5 or later.
 * Returns the verdict (ok/untestedMajor/tooOld/notFusion).
 */
export function checkFusionVersion() {
  try {
    const result = spawnSync("dbt", ["--version"], {
      encoding: "utf-8",
      timeout: 5_000,
    });

    if (result.error || result.status !== 0) {
      return { kind: "notFusion" as const, raw: "" };
    }

    const stdout = result.stdout || "";
    const version = parseFusionVersion(stdout);
    return judgeFusionVersion(version, stdout);
  } catch {
    return { kind: "notFusion" as const, raw: "" };
  }
}
