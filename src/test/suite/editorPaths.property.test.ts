import { describe, expect, it } from "@jest/globals";
import fc from "fast-check";
import * as path from "path";
import { toLspArgs } from "../../core/lsp";
import { isDbtTemplateFile, ProjectPaths } from "../../core/project";
import {
  associatedLanguage,
  dbtTemplateAssociations,
} from "../../dbt_integration/dbtAssociations";
import {
  NUM_RUNS,
  relativeDir,
  segment,
  staticAnalysisMode,
} from "../arbitraries";

const root = path.join("/", "repo", "proj");
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

describe("isDbtTemplateFile properties", () => {
  it("accepts every .sql file under a declared model path", () => {
    fc.assert(
      fc.property(
        projectPaths,
        fc.array(segment, { maxLength: 3 }),
        segment,
        (paths, sub, name) => {
          const file = path.join(paths.modelPaths[0], ...sub, `${name}.sql`);
          expect(isDbtTemplateFile(paths, file)).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects every file under the target path", () => {
    fc.assert(
      fc.property(
        projectPaths,
        fc.array(segment, { maxLength: 4 }),
        segment,
        (paths, sub, name) => {
          expect(
            isDbtTemplateFile(
              paths,
              path.join(paths.targetPath, ...sub, `${name}.sql`),
            ),
          ).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects non-.sql files anywhere", () => {
    fc.assert(
      fc.property(
        projectPaths,
        segment,
        fc.constantFrom(".yml", ".md", ".py", ""),
        (paths, name, ext) => {
          expect(
            isDbtTemplateFile(
              paths,
              path.join(paths.modelPaths[0], `${name}${ext}`),
            ),
          ).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe("associatedLanguage properties", () => {
  it("lets the longest matching pattern win", () => {
    fc.assert(
      fc.property(relativeDir, segment, (dir, name) => {
        const file = path.join("/", "repo", dir, `${name}.sql`);
        const associations = {
          "*.sql": "sql",
          [`${dir}/**/*.sql`]: "jinja-sql",
        };
        expect(
          associatedLanguage(associations, path.join("/", "repo"), file),
        ).toBe("jinja-sql");
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("matches a pattern without a slash against the file name only", () => {
    fc.assert(
      fc.property(
        fc.array(segment, { minLength: 1, maxLength: 4 }),
        segment,
        (dirs, name) => {
          const file = path.join("/", "repo", ...dirs, `${name}.sql`);
          expect(
            associatedLanguage(
              { [`${name}.sql`]: "snowflake-sql" },
              path.join("/", "repo"),
              file,
            ),
          ).toBe("snowflake-sql");
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("the associations written for a project match every template it declares", () => {
    fc.assert(
      fc.property(
        projectPaths,
        fc.array(segment, { maxLength: 2 }),
        segment,
        (paths, sub, name) => {
          const folder = path.dirname(root);
          const written = dbtTemplateAssociations(folder, paths);
          const file = path.join(paths.macroPaths[0], ...sub, `${name}.sql`);
          expect(associatedLanguage(written, folder, file)).toBe("jinja-sql");
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
