import fc from "fast-check";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { resolveProfilesDir } from "../../core/project/dbtEnvironment";
import { NUM_RUNS } from "../arbitraries";

const root = path.join("/", "ws", "proj");
const home = path.join("/", "home", "me");
const never = () => false;

const dir = fc.stringMatching(/^\/[a-z]{1,6}(\/[a-z]{1,6}){0,2}$/);
const maybeBlank = fc.option(fc.constantFrom("", "  "), { nil: undefined });

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
