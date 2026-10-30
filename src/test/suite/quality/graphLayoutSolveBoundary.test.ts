import {
  type ICruiseResult,
  type IConfiguration,
  cruise,
} from "dependency-cruiser";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The import direction of packages/graph-layout/src/solve/ is the dependency-cruiser rule `solve-is-self-contained`
// (.dependency-cruiser.cjs). These tests run that rule alone: on the real solve/ tree, which must be clean, and on a
// planted tree in a temporary directory that holds one forbidden import and one allowed import, so the rule is seen
// to fire on the first and not the second.

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const RULE = "solve-is-self-contained";
const require = createRequire(import.meta.url);
const config = require(join(ROOT, ".dependency-cruiser.cjs")) as IConfiguration;

const ruleSet = {
  forbidden: (config.forbidden ?? []).filter((rule) => rule.name === RULE),
};

/** Runs the solve rule over `paths`, relative to `baseDir`, and returns the imports it reports as crossing the boundary. */
async function solveViolations(
  baseDir: string,
  paths: string[],
  options: IConfiguration["options"] = {},
): Promise<string[]> {
  const { output } = await cruise(paths, {
    ...options,
    baseDir,
    ruleSet,
    validate: true,
  });
  const summary = (output as ICruiseResult).summary;
  return summary.violations
    .filter((v) => v.rule.name === RULE)
    .map((v) => `${v.from} -> ${v.to}`);
}

describe("solve/ imports nothing from outside itself", () => {
  it("the real solve/ tree has no import across its boundary", async () => {
    expect(
      await solveViolations(
        ROOT,
        ["packages/graph-layout/src/solve"],
        config.options,
      ),
    ).toEqual([]);
  });

  describe("on a planted tree", () => {
    let planted: string;

    beforeAll(async () => {
      // realpath: tmpdir() is a symlink on macOS, and the rule matches the resolved path.
      planted = await realpath(
        await mkdtemp(join(tmpdir(), "solve-boundary-")),
      );
      const files: Record<string, string> = {
        "packages/graph-layout/src/place/planted-target.ts":
          "export const target = 1;\n",
        // Forbidden: solve/ reaches into place/.
        "packages/graph-layout/src/solve/planted-violation.ts":
          'import { target } from "../place/planted-target";\nexport const violation = target;\n',
        // Allowed: solve/ imports its own sibling.
        "packages/graph-layout/src/solve/planted-allowed.ts":
          'import { violation } from "./planted-violation";\nexport const allowed = violation;\n',
      };
      for (const [name, text] of Object.entries(files)) {
        await mkdir(dirname(join(planted, name)), { recursive: true });
        await writeFile(join(planted, name), text);
      }
    });

    afterAll(async () => {
      await rm(planted, { recursive: true, force: true });
    });

    it("reports the import from solve/ into place/ and not the import within solve/", async () => {
      const reported = await solveViolations(
        planted,
        ["packages/graph-layout/src/solve"],
        { tsPreCompilationDeps: false },
      );
      expect(reported).toEqual([
        "packages/graph-layout/src/solve/planted-violation.ts -> packages/graph-layout/src/place/planted-target.ts",
      ]);
    });
  });
});
