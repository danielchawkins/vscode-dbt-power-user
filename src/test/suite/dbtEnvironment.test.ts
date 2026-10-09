import fc from "fast-check";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import {
  projectDirVariable,
  resolveProfilesDir,
} from "../../core/project/dbtEnvironment";
import { NUM_RUNS } from "../arbitraries";

const root = path.join("/", "ws", "proj");
const home = path.join("/", "home", "me");
const never = () => false;
const identity = (value: string) => value;

const dir = fc.stringMatching(/^\/[a-z]{1,6}(\/[a-z]{1,6}){0,2}$/);
const maybeBlank = fc.option(fc.constantFrom("", "  "), { nil: undefined });

describe("projectDirVariable", () => {
  it("is undefined when neither variable is set or both are blank", () => {
    expect(projectDirVariable({}, root, identity)).toBeUndefined();
    expect(
      projectDirVariable({ DBT_PROJECT_DIR: " " }, root, identity),
    ).toBeUndefined();
  });

  it("is undefined when the variable names the root", () => {
    expect(
      projectDirVariable({ DBT_PROJECT_DIR: root }, root, identity),
    ).toBeUndefined();
    expect(
      projectDirVariable({ DBT_ENGINE_PROJECT_DIR: "." }, root, identity),
    ).toBeUndefined();
  });

  it("names the variable and value when the directory differs", () => {
    expect(
      projectDirVariable({ DBT_PROJECT_DIR: "/elsewhere" }, root, identity),
    ).toEqual({ name: "DBT_PROJECT_DIR", value: "/elsewhere" });
  });

  it("lets DBT_ENGINE_PROJECT_DIR decide when both are set", () => {
    const env = {
      DBT_ENGINE_PROJECT_DIR: root,
      DBT_PROJECT_DIR: "/elsewhere",
    };
    expect(projectDirVariable(env, root, identity)).toBeUndefined();
    expect(
      projectDirVariable(
        { ...env, DBT_ENGINE_PROJECT_DIR: "/other" },
        root,
        identity,
      ),
    ).toEqual({ name: "DBT_ENGINE_PROJECT_DIR", value: "/other" });
  });

  it("compares canonical paths, so a symlink to the root is not a difference", () => {
    const base = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "fpu-")),
    );
    try {
      const real = path.join(base, "real");
      const link = path.join(base, "link");
      fs.mkdirSync(real);
      fs.symlinkSync(real, link);

      expect(
        projectDirVariable({ DBT_PROJECT_DIR: link }, real),
      ).toBeUndefined();
      expect(
        projectDirVariable({ DBT_PROJECT_DIR: real }, link),
      ).toBeUndefined();
      expect(projectDirVariable({ DBT_PROJECT_DIR: base }, real)).toEqual({
        name: "DBT_PROJECT_DIR",
        value: base,
      });
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("reports a variable exactly when the directory differs from the root", () => {
    fc.assert(
      fc.property(dir, dir, (value, projectRoot) => {
        const found = projectDirVariable(
          { DBT_PROJECT_DIR: value },
          projectRoot,
          identity,
        );
        expect(found !== undefined).toBe(value !== projectRoot);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe("resolveProfilesDir", () => {
  const exists = (file: string) => file === path.join(root, "profiles.yml");

  it("prefers the setting over every variable", () => {
    expect(
      resolveProfilesDir(
        "/setting",
        { DBT_ENGINE_PROFILES_DIR: "/engine", DBT_PROFILES_DIR: "/dbt" },
        root,
        home,
        exists,
      ),
    ).toBe("/setting");
  });

  it("prefers DBT_ENGINE_PROFILES_DIR over DBT_PROFILES_DIR", () => {
    const env = {
      DBT_ENGINE_PROFILES_DIR: "/engine",
      DBT_PROFILES_DIR: "/dbt",
    };
    expect(resolveProfilesDir(undefined, env, root, home, exists)).toBe(
      "/engine",
    );
    expect(
      resolveProfilesDir(
        undefined,
        { DBT_PROFILES_DIR: "/dbt" },
        root,
        home,
        exists,
      ),
    ).toBe("/dbt");
  });

  it("uses the root when it has a profiles.yml, else ~/.dbt", () => {
    expect(resolveProfilesDir(undefined, {}, root, home, exists)).toBe(root);
    expect(resolveProfilesDir(undefined, {}, root, home, never)).toBe(
      path.join(home, ".dbt"),
    );
  });

  it("treats blank values as unset", () => {
    expect(
      resolveProfilesDir(" ", { DBT_PROFILES_DIR: "" }, root, home, never),
    ).toBe(path.join(home, ".dbt"));
  });

  it("returns the first non-blank source in precedence order", () => {
    fc.assert(
      fc.property(
        fc.option(dir, { nil: undefined }),
        fc.option(dir, { nil: undefined }),
        fc.option(dir, { nil: undefined }),
        maybeBlank,
        fc.boolean(),
        (setting, engine, legacy, blank, hasProfiles) => {
          const result = resolveProfilesDir(
            setting ?? blank,
            {
              DBT_ENGINE_PROFILES_DIR: engine ?? blank,
              DBT_PROFILES_DIR: legacy ?? blank,
            },
            root,
            home,
            () => hasProfiles,
          );
          const fallback = hasProfiles ? root : path.join(home, ".dbt");
          expect(result).toBe(setting ?? engine ?? legacy ?? fallback);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
