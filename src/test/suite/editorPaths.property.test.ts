import fc from "fast-check";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { toLspArgs } from "../../core/lsp";
import { ProjectPaths } from "../../core/project";
import { dbtTemplateAssociations } from "../../dbt_integration/dbtAssociations";
import {
  NUM_RUNS,
  relativeDir,
  segment,
  staticAnalysisMode,
} from "../arbitraries";
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

describe("toLspArgs properties", () => {
  const input = fc.record({
    port: fc.integer({ min: 1, max: 65535 }),
    projectDir: relativeDir.map(abs),
    commandPrefix: segment.map((s) => `fusionPowerUser:${s}:`),
    lintEnabled: fc.boolean(),
    staticAnalysis: staticAnalysisMode,
    logLevel: fc.constantFrom(undefined, "debug" as const, "trace" as const),
    profilesDir: fc.option(relativeDir.map(abs), { nil: undefined }),
    target: fc.option(segment, { nil: undefined }),
  });
  type Input = typeof input extends fc.Arbitrary<infer T> ? T : never;
  const argsFor = (i: Input) =>
    toLspArgs(
      {
        executable: { source: "path" },
        projectDir: i.projectDir,
        target: i.target,
        profile: undefined,
        profilesDir: i.profilesDir,
        staticAnalysis: i.staticAnalysis,
        lintEnabled: i.lintEnabled,
        logLevel: i.logLevel,
        environment: {},
      },
      {
        port: i.port,
        commandPrefix: i.commandPrefix,
        projectDir: i.projectDir,
      },
    );

  const valueOf = (args: string[], flag: string) => {
    const i = args.indexOf(flag);
    return i < 0 ? undefined : args[i + 1];
  };

  it("carries every input as a flag value exactly once and never an empty argument", () => {
    fc.assert(
      fc.property(input, (i) => {
        const args = argsFor(i);
        expect(args[0]).toBe("lsp");
        expect(args.every((a) => a.length > 0)).toBe(true);
        expect(valueOf(args, "--socket")).toBe(String(i.port));
        expect(valueOf(args, "--project-dir")).toBe(i.projectDir);
        expect(valueOf(args, "--command-prefix")).toBe(i.commandPrefix);
        expect(valueOf(args, "--lint-enabled")).toBe(String(i.lintEnabled));
        expect(valueOf(args, "--profiles-dir")).toBe(i.profilesDir);
        expect(valueOf(args, "--target")).toBe(i.target);
        expect(valueOf(args, "--log-level")).toBe(i.logLevel);
        for (const flag of args.filter((a) => a.startsWith("--"))) {
          expect(args.filter((a) => a === flag)).toHaveLength(1);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("omits --static-analysis exactly when the mode is project", () => {
    fc.assert(
      fc.property(input, (i) => {
        const value = valueOf(argsFor(i), "--static-analysis");
        expect(value).toBe(
          i.staticAnalysis === "project" ? undefined : i.staticAnalysis,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
