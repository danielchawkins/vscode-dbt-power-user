import { realpathSync } from "fs";
import * as path from "path";

/** The variables dbt Fusion reads for the project directory, in precedence order. */
const PROJECT_DIR_VARIABLES = [
  "DBT_ENGINE_PROJECT_DIR",
  "DBT_PROJECT_DIR",
] as const;

/** The variables dbt Fusion reads for the profiles directory, in precedence order. */
const PROFILES_DIR_VARIABLES = [
  "DBT_ENGINE_PROFILES_DIR",
  "DBT_PROFILES_DIR",
] as const;

type Environment = Readonly<Record<string, string | undefined>>;

function canonicalPath(value: string): string {
  try {
    return realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

/**
 * The project-directory variable in `env` that names a different directory than `root`, or `undefined` when none is
 * set, the first one set names `root`, or it is blank. The first variable set in dbt's precedence order decides.
 * Paths are compared by realpath, so a symlink to `root` is not a difference; a relative value resolves against
 * `root`. `canonical` is replaceable for tests.
 *
 * The extension always passes `--project-dir <root>`, which takes precedence over these variables.
 */
export function projectDirVariable(
  env: Environment,
  root: string,
  canonical: (value: string) => string = canonicalPath,
): { name: (typeof PROJECT_DIR_VARIABLES)[number]; value: string } | undefined {
  for (const name of PROJECT_DIR_VARIABLES) {
    const value = env[name];
    if (!value?.trim()) {
      continue;
    }
    return canonical(path.resolve(root, value)) === canonical(root)
      ? undefined
      : { name, value };
  }
  return undefined;
}

/**
 * The directory dbt reads `profiles.yml` from, by dbt's precedence: the `setting`, then `DBT_ENGINE_PROFILES_DIR`,
 * then `DBT_PROFILES_DIR`, then `root` when it has a `profiles.yml`, then `~/.dbt`. Blank values are unset.
 * `exists` reports whether a file exists.
 */
export function resolveProfilesDir(
  setting: string | undefined,
  env: Environment,
  root: string,
  home: string,
  exists: (file: string) => boolean,
): string {
  const configured = [setting, ...PROFILES_DIR_VARIABLES.map((n) => env[n])];
  const first = configured.find((value) => value?.trim());
  if (first) {
    return first;
  }
  return exists(path.join(root, "profiles.yml"))
    ? root
    : path.join(home, ".dbt");
}
