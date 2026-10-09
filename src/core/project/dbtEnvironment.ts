import * as path from "path";

/** The variables dbt Fusion reads for the profiles directory, in precedence order. */
const PROFILES_DIR_VARIABLES = [
  "DBT_ENGINE_PROFILES_DIR",
  "DBT_PROFILES_DIR",
] as const;

type Environment = Readonly<Record<string, string | undefined>>;

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
