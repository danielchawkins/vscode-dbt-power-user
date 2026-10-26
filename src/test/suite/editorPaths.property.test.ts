import fc from "fast-check";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { dbtTemplateAssociations } from "../../core/dbt/dbtAssociations";
import type { ProjectPaths } from "../../core/snapshot";
import { NUM_RUNS, relativeDir, segment } from "../arbitraries";
import { match } from "../vscodeGlob";

const root = path.join("/", "re[po]", "(x86)}p!*?j");
const abs = (rel: string) => path.join(root, rel);

const projectPaths = fc
  .record({
    model: fc.array(relativeDir, { minLength: 1, maxLength: 3 }),
    macro: fc.array(relativeDir, { minLength: 1, maxLength: 2 }),
  })
  .filter(
    ({ model, macro }) =>
      ![...model, ...macro].some(
        (d) => d === "target" || d.startsWith("target/"),
      ),
  )
  .map(({ model, macro }): ProjectPaths => ({
    modelPaths: model.map(abs),
    macroPaths: macro.map(abs),
    seedPaths: [abs("seeds")],
    snapshotPaths: [abs("snapshots")],
    analysisPaths: [abs("analyses")],
    testPaths: [abs("tests")],
    targetPath: abs("target"),
    packagesInstallPath: abs("dbt_packages"),
  }));

const matches = (value: string, pattern: string) => match(pattern, value, true);

/** VS Code's `files.associations` precedence: `/` patterns match the absolute path, longer patterns win. */
function associatedLanguage(
  associations: Record<string, string>,
  fsPath: string,
): string | undefined {
  const absolute = fsPath.split(path.sep).join("/");
  const name = path.basename(fsPath);
  let best: { pattern: string; language: string } | undefined;
  for (const [pattern, language] of Object.entries(associations)) {
    const matched = matches(pattern.includes("/") ? absolute : name, pattern);
    if (matched && (!best || pattern.length > best.pattern.length)) {
      best = { pattern, language };
    }
  }
  return best?.language;
}

describe("dbtTemplateAssociations properties", () => {
  it("the associations written for a project match every template it declares and nothing in target", () => {
    fc.assert(
      fc.property(
        projectPaths,
        fc.array(segment, { maxLength: 2 }),
        segment,
        (paths, sub, name) => {
          const { associations: written } = dbtTemplateAssociations(
            root,
            paths,
          );
          const file = path.join(paths.macroPaths[0], ...sub, `${name}.sql`);
          expect(associatedLanguage(written, file)).toBe("jinja-sql");
          const compiled = path.join(paths.targetPath, ...sub, `${name}.sql`);
          expect(associatedLanguage(written, compiled)).toBeUndefined();
          const copy = path.join(
            paths.targetPath,
            "compiled",
            "p",
            path.relative(root, paths.macroPaths[0]),
            `${name}.sql`,
          );
          expect(associatedLanguage(written, copy)).toBeUndefined();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
