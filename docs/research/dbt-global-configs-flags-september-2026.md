# dbt global configs: flags, environment variables, and precedence

Captured 2026-09-23 from <https://docs.getdbt.com/reference/global-configs/about-global-configs?version=2#available-flags> (page last updated 2026-09-16, documenting the dbt v2 engine). This is a condensed reference for the flags this extension touches; consult the source page for the full table.

## Precedence

> The most specific setting "wins." CLI options take the highest precedence, followed by environment variables, then `dbt_project.yml`, and finally `user_settings.yml`. If you set the flag in none of those places, it will use the default value defined within dbt.

So, highest to lowest: **CLI option → environment variable → `dbt_project.yml` → `~/.dbt/user_settings.yml` → dbt's built-in default**. `user_settings.yml` holds machine-wide personal preferences and is written automatically by `dbt login`.

## Environment variable prefixes

> v1.10 and earlier use the `DBT_` prefix, while v1.11+ uses the `DBT_ENGINE_` prefix.

`DBT_PROFILES_DIR` and `DBT_ENGINE_PROFILES_DIR` are the legacy and current spellings of a single flag. When both are set they do not tie: the current `DBT_ENGINE_` spelling wins. Verified against Fusion 2.0.5 with a project-adjacent `profiles.yml`:

| `DBT_PROFILES_DIR` | `DBT_ENGINE_PROFILES_DIR` | Result                                                   |
| ------------------ | ------------------------- | -------------------------------------------------------- |
| project dir        | unset                     | `Loading profiles.yml`, succeeds                         |
| project dir        | `~/.dbt`                  | `Loading ~/.dbt/profiles.yml`, fails to find the profile |
| unset              | unset                     | `Loading profiles.yml`, succeeds                         |

So exporting only the legacy variable does not override the current one. A machine that exports `DBT_ENGINE_PROFILES_DIR` globally redirects every dbt invocation that does not pass `--profiles-dir`, whether it comes from a terminal or from this extension.

## Flags relevant to this extension

Columns follow the source table: whether the dbt platform CLI supports the flag, the type and default, whether it can be set in `dbt_project.yml`, the environment variable, and the CLI option.

| Flag            | dbt CLI      | Type / default                                      | In project              | Env var                                      | CLI option                               |
| --------------- | ------------ | --------------------------------------------------- | ----------------------- | -------------------------------------------- | ---------------------------------------- |
| `profiles_dir`  | ❌           | path, default None (**current dir, then HOME dir**) | ❌                      | `DBT_ENGINE_PROFILES_DIR`                    | `--profiles-dir`                         |
| `project_dir`   | ❌           | path, default (empty)                               | ❌                      | `DBT_ENGINE_PROJECT_DIR`                     | `--project-dir`                          |
| `profile`       | ❌           | string, default None                                | ✅ (top-level key)      | `DBT_ENGINE_PROFILE`                         | `--profile`                              |
| `target`        | ❌           | string, default None                                | ❌                      | `DBT_ENGINE_TARGET`                          | `--target`                               |
| `target_path`   | ❌           | path, default None (uses `target/`)                 | ❌                      | `DBT_ENGINE_TARGET_PATH`                     | `--target-path`                          |
| `log_path`      | ❌           | path, default None (uses `logs/`)                   | ❌                      | `DBT_ENGINE_LOG_PATH`                        | `--log-path`                             |
| `log_format`    | ❌           | enum, default text                                  | ✅                      | `DBT_ENGINE_LOG_FORMAT`                      | `--log-format`                           |
| `log_level`     | ❌           | enum, default info                                  | ✅                      | `DBT_ENGINE_LOG_LEVEL`                       | `--log-level`                            |
| `defer`         | ✅ (default) | boolean, default False                              | ❌                      | `DBT_ENGINE_DEFER`                           | `--defer` / `--no-defer`                 |
| `state`         | ❌           | path, default none                                  | ❌                      | `DBT_ENGINE_STATE`, `DBT_ENGINE_DEFER_STATE` | `--state` / `--defer-state`              |
| `favor_state`   | ✅           | boolean, default False                              | ❌                      | `DBT_ENGINE_FAVOR_STATE`                     | `--favor-state` / `--no-favor-state`     |
| `full_refresh`  | ✅           | boolean, default False                              | ✅ (as resource config) | `DBT_ENGINE_FULL_REFRESH`                    | `--full-refresh` / `--no-full-refresh`   |
| `version_check` | ❌           | boolean, default varies                             | ✅                      | `DBT_ENGINE_VERSION_CHECK`                   | `--version-check` / `--no-version-check` |
| `partial_parse` | ✅           | boolean, default True                               | ✅                      | `DBT_ENGINE_PARTIAL_PARSE`                   | `--partial-parse` / `--no-partial-parse` |
| `write_json`    | ✅           | boolean, default True                               | ✅                      | `DBT_ENGINE_WRITE_JSON`                      | `--write-json` / `--no-write-json`       |
| `quiet`         | ✅           | boolean, default False                              | ❌                      | `DBT_ENGINE_QUIET`                           | `--quiet`                                |

## Consequences for how the extension invokes dbt

`profiles_dir` defaults to the **current directory, then the HOME directory**. Nothing in the documented cascade looks beside `dbt_project.yml`, and `profiles_dir` cannot be set in `dbt_project.yml`. A project-adjacent `profiles.yml` is found only because the working directory is usually the project root; `--project-dir` does not move the profiles lookup. An invocation whose working directory is not the project root therefore falls through to `~/.dbt` and, for a project whose profile lives only in its own directory, fails to resolve.

A dbt invocation from the owning project folder with an inherited environment reproduces terminal behavior exactly. That is the whole contract: set the working directory correctly, inherit the environment, and add a flag only for an explicit user override, which then wins as the highest-precedence input.

Runtime path flags — `profiles_dir`, `project_dir`, `target_path`, `log_path`, `state` — are settable only by CLI option or environment variable, never in `dbt_project.yml`. A Consumer Repository cannot commit these, so respecting the ambient environment is the only way its intent reaches dbt.

`log_path` defaults to `logs/` relative to the project, so a `logs/dbt.log` appearing under the project root confirms `project_dir` resolution only. It is not evidence about the working directory.
