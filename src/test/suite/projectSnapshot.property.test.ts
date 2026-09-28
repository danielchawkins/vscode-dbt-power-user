import { describe, expect, it } from "@jest/globals";
import fc from "fast-check";
import * as path from "path";
import {
  resolveProjectSnapshot,
  substituteVariables,
} from "../../core/project";
import { NUM_RUNS } from "../arbitraries";
import {
  snapshotFolder as folder,
  snapshotInputs as inputs,
} from "../arbitraries/projectSnapshot";

const inside = (root: string, p: string) => {
  const rel = path.relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

describe("resolveProjectSnapshot properties", () => {
  it("resolves every relative project path to an absolute path inside the root", () => {
    fc.assert(
      fc.property(inputs, (i) => {
        const { paths, invocation } = resolveProjectSnapshot(i);
        const all = [
          ...paths.modelPaths,
          ...paths.seedPaths,
          ...paths.macroPaths,
          ...paths.snapshotPaths,
          ...paths.analysisPaths,
          ...paths.testPaths,
          paths.targetPath,
          paths.packagesInstallPath,
          invocation.compiledOutput.dir,
        ];
        for (const p of all) {
          expect(path.isAbsolute(p)).toBe(true);
          expect(inside(i.root, p)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("uses declared paths and dbt's defaults for absent keys", () => {
    fc.assert(
      fc.property(inputs, (i) => {
        const { paths } = resolveProjectSnapshot(i);
        const config = i.projectFile.config as Record<string, string[]>;
        const at = (rel: string) => path.resolve(i.root, rel);
        expect(paths.modelPaths).toEqual(
          (config["model-paths"] ?? ["models"]).map(at),
        );
        expect(paths.testPaths).toEqual(
          (config["test-paths"] ?? ["tests"]).map(at),
        );
        expect(paths.seedPaths).toEqual([at("seeds")]);
        expect(paths.targetPath).toEqual(
          at((config["target-path"] as unknown as string) ?? "target"),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("names the project from the project file, else the root directory", () => {
    fc.assert(
      fc.property(inputs, (i) => {
        const name = i.projectFile.config.name;
        expect(resolveProjectSnapshot(i).name).toBe(
          typeof name === "string" ? name : path.basename(i.root),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("writes compiled SQL to the target path or directly under it", () => {
    fc.assert(
      fc.property(inputs, (i) => {
        const { paths, invocation } = resolveProjectSnapshot(i);
        const { dir, mode } = invocation.compiledOutput;
        expect(mode === "shared" ? dir : path.dirname(dir)).toBe(
          paths.targetPath,
        );
        expect(dir === paths.targetPath).toBe(mode === "shared");
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe("substituteVariables properties", () => {
  const scope = (env: Record<string, string>) => ({
    folder: folder,
    userHome: path.join("/", "home", "u"),
    lookup: (name: string) => env[name],
  });

  it("is the identity on strings without a placeholder", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !s.includes("${")),
        (value) => {
          expect(substituteVariables(value, scope({}))).toBe(value);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("inserts environment values verbatim, including replacement patterns", () => {
    fc.assert(
      fc.property(
        fc.string({
          unit: fc.constantFrom("$", "&", "1", "`", "'", "<", ">", "a"),
        }),
        (value) => {
          expect(substituteVariables("${env:V}", scope({ V: value }))).toBe(
            value,
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
