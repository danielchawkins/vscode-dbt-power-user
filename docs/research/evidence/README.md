# Fusion lineage and native editor features: consolidated evidence

**Scope:** dbt Fusion 2.0.6, `/Users/daniel/.local/share/mise/installs/aqua-getdbt-com-dbt-fusion/2.0.6/dbt`, sha256 `9fc5cd633558235a5eb4e265b5fea2aa8dbb4eb803a5e13872e6e80a5bbd4c15`. Darwin 25.5.0 arm64, DuckDB, the four-model fixture in `scripts/evidence/fixture/`. Captured 2026-09-26.

**Reproducing:** `DBT_BIN=<abs dbt> scripts/evidence/run.sh <experiment> <out-root>` runs every command under `env -i` with only the variables listed per step. `scripts/evidence/README.md` describes the harness.

**Sources used besides runs:**

- [About flags](https://docs.getdbt.com/reference/global-configs/about-global-configs?version=2) and [About static analysis](https://docs.getdbt.com/docs/build/about-static-analysis?version=2).
- The open-source Fusion crates at `~/references/dbt-fusion`, commit `9977b6c` (2026-06-04). That is older than the 2.0.6 binary, so a source statement is evidence about the open crates, not proof about the binary.

The earlier per-area write-ups in this folder are kept as run records only. Where they conflict with this document, this document wins; see [Superseded premises](#superseded-premises).

## 1. How configuration reaches Fusion

### Environment variables

- **The documented prefix is `DBT_ENGINE_`.** The docs say: "v1.10 and earlier use the `DBT_` prefix, while v1.11+ uses the `DBT_ENGINE_` prefix", with precedence CLI option → environment variable → `dbt_project.yml` → `user_settings.yml` → default. Their flag table has no environment variable for `generate_info_schema` or `info_schema_dir` ("—"), and does not list `static_analysis` at all.
- **Source: aliasing.** `crates/dbt-main/src/vars.rs` `apply_engine_env_var_aliases()` copies `DBT_ENGINE_<X>` to `DBT_<X>` for a fixed list (`ALIASABLE_ENV_VARS`, which includes `DBT_STATIC_ANALYSIS`, `DBT_PROFILES_DIR`, `DBT_TARGET_PATH`), but only when `DBT_<X>` is unset. It runs from `main_impl.rs` before CLI parsing. `validate_engine_env_vars()` rejects unknown `DBT_ENGINE_*` names.
- **Source: help text.** Clap binds `--static-analysis` to `DBT_STATIC_ANALYSIS` for the CLI subcommands (`crates/dbt-clap-core/src/lib.rs`). `dbt lsp --help` shows no `[env: …]` binding for `--static-analysis`. `dbt compile --help` shows `[env: DBT_STATIC_ANALYSIS=]`.
- **The operator shell:** it exports `DBT_ENGINE_PROFILES_DIR=~/.dbt`. The harness therefore sets `DBT_ENGINE_PROFILES_DIR` to the fixture and also passes `--profiles-dir`.

### `static_analysis` for the CLI: experiment `m1-static-analysis-sources`

**Signal:** `models/probe_strict.sql` = `select no_such_column from {{ ref('stg_orders') }}`, compiled with `dbt compile --profiles-dir <P> -s +probe_strict [flags]` and no `--generate-info-schema`. Only strict analysis resolves columns, so `[error] [UnresolvedIdentifier (dbt0227)]: No column no_such_column found` with exit 1 means strict was in effect. All steps set `FUSION_POWER_USER_SCHEMA_ORIGIN=local`.

| Step | CLI flag                     | Environment                                                      | `dbt_project.yml` addition                                              | Exit | dbt0227 |
| ---- | ---------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- | ---- | ------- |
| 02   | —                            | —                                                                | —                                                                       | 0    | no      |
| 03   | `--static-analysis baseline` | —                                                                | —                                                                       | 0    | no      |
| 04   | `--static-analysis strict`   | —                                                                | —                                                                       | 1    | yes     |
| 05   | —                            | `DBT_ENGINE_STATIC_ANALYSIS=strict`                              | —                                                                       | 1    | yes     |
| 06   | `--static-analysis baseline` | `DBT_ENGINE_STATIC_ANALYSIS=strict`                              | —                                                                       | 0    | no      |
| 07   | —                            | `DBT_STATIC_ANALYSIS=baseline DBT_ENGINE_STATIC_ANALYSIS=strict` | —                                                                       | 1    | yes     |
| 08   | —                            | —                                                                | `models: lineage_probe: +static_analysis: strict`                       | 1    | yes     |
| 09   | `--static-analysis baseline` | —                                                                | same as 08                                                              | 0    | no      |
| 10   | —                            | `DBT_ENGINE_STATIC_ANALYSIS=baseline`                            | same as 08                                                              | 0    | no      |
| 11   | —                            | —                                                                | `flags: static_analysis: strict`                                        | 0    | no      |
| 12   | —                            | —                                                                | `+static_analysis: baseline` on the project, `strict` on `probe_strict` | 0    | no      |

What these rows show, in this fixture with this binary:

- **Where strict can be set:** the CLI flag (04), `DBT_ENGINE_STATIC_ANALYSIS` (05), and model config in `dbt_project.yml` (08) each turned strict on.
- **Precedence:** the flag overrode both the environment variable (06) and model config (09), and the environment variable overrode model config (10). That matches the documented order.
- **Two variables set at once:** with `DBT_STATIC_ANALYSIS=baseline` and `DBT_ENGINE_STATIC_ANALYSIS=strict`, the result was strict (07). The aliasing source copies only when `DBT_<X>` is unset, so it predicts baseline here; the observed result does not match that prediction. The mechanism is not established.
- **`flags: static_analysis: strict`** in `dbt_project.yml` did not enable strict (11). The docs' flag table does not list `static_analysis`.
- **Strict on a child under a baseline parent** did not take effect (12). This matches the documented rule that "a model can't be stricter than its parents".

### `static_analysis` for the language server: experiment `m2-lsp-static-analysis-sources`

Each session starts on an empty `target/` and runs `steps/editor-features.json`. Server argv: `<dbt> lsp --socket <port> --project-dir <P> --profiles-dir <P> --lint-enabled false --no-version-check --command-prefix "" --log-level-file trace --otel-file-name <file> [flag]`. Environment: `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1`, plus the listed variable.

| Step | Flag                         | Environment                         | `dbt_project.yml` addition                        | hover on `*` | references on alias `total` | rename of `total` |
| ---- | ---------------------------- | ----------------------------------- | ------------------------------------------------- | ------------ | --------------------------- | ----------------- |
| 02   | —                            | —                                   | —                                                 | `null`       | `null`                      | `null`            |
| 03   | `--static-analysis strict`   | —                                   | —                                                 | column table | 2 locations                 | edits in 2 files  |
| 04   | —                            | `DBT_ENGINE_STATIC_ANALYSIS=strict` | —                                                 | `null`       | `null`                      | `null`            |
| 05   | —                            | —                                   | `models: lineage_probe: +static_analysis: strict` | column table | 2 locations                 | edits in 2 files  |
| 06   | `--static-analysis baseline` | —                                   | same as 05                                        | `null`       | `null`                      | `null`            |

- **What enabled strict:** the flag (03) or model config in `dbt_project.yml` (05). The environment variable did not (04), which is consistent with the language server's `--static-analysis` having no env binding in its help text.
- **Precedence:** the flag overrode model config (06).
- **Consequence for the extension:** it always passes `--static-analysis` (`buildFusionLspArgs`, from `fusionPowerUser.staticAnalysis`, default `baseline`). So as the extension is written today, a project's own `+static_analysis: strict` is overridden by the extension's `baseline`.

## 2. Strict analysis without `dbt login`

**The docs say:** "Any run that uses `strict` mode requires authentication using `dbt login`, whether `strict` is set with the `--static-analysis strict` CLI flag or in `dbt_project.yml`. Unauthenticated runs fall back to `baseline`."

**What the code and binary show:**

- **Open source:** the licence hook is a trait with only a no-op implementation, `LicenseFetcher` / `NoOpLicenseFetcher` in `crates/dbt-login/src/license_fetcher.rs`. `LicenseError = 1068` in `crates/dbt-error/src/codes.rs`. `rg` finds no caller of either and no code that downgrades strict when unauthenticated. The one unconditional override is in `crates/dbt-clap-core/src/lib.rs`, which forces `Strict` when `local_execution_backend != Remote`. `CHANGELOG.md` records "Implement licensing for strict static analysis".
- **Shipped binary:** `strings` on the 2.0.6 binary finds licence code the open crates do not have:
  - the variables `DBT_LICENSE`, `DBT_SKIP_REMOTE_LICENSE`, `DBT_LICENSE_USE_KEYCHAIN`, `DBT_LICENSE_REFRESH_WINDOW_SECONDS`, `DBT_TRIAL_LICENSE_URL` and `DBT_CLIENT_INSTALL_DATE`;
  - the endpoint `https://cloud.getdbt.com/api/private/trial-licenses/`;
  - the keychain service `com.dbt.licensing`;
  - the messages "Trial license retrieved", "Your 14-day trial has ended. Sign up for a free dbt platform account to unlock premium features", "No platform credentials found, skipping remote license", "Trial license expired for this machine (403)", and "Continuing without dbt platform. Strict static analysis will be unavailable."

  Where each is used is not visible from strings.

**Recorded runs:** experiment `m3-strict-authentication`, signal dbt0227 as in M1.

| Step | Environment beyond the base                                          | Result                                                 |
| ---- | -------------------------------------------------------------------- | ------------------------------------------------------ |
| 02   | —                                                                    | `dbt login status`: `Status: unauthenticated`          |
| 03   | —                                                                    | strict compile: exit 1, dbt0227                        |
| 04   | `HOME=<out>/empty-home`                                              | `dbt login status`: `Status: unauthenticated`          |
| 05   | `HOME=<out>/empty-home`                                              | exit 1, dbt0227                                        |
| 06   | `HOME=<out>/empty-home DBT_SKIP_REMOTE_LICENSE=1`                    | exit 1, dbt0227                                        |
| 07   | `HOME=<out>/empty-home DBT_CLIENT_INSTALL_DATE=2024-01-01`           | exit 1, dbt0227                                        |
| 08   | `HOME=<out>/empty-home DBT_CLIENT_INSTALL_DATE=2024-01-01T00:00:00Z` | exit 1, dbt0227                                        |
| 09   | —                                                                    | the empty HOME afterwards contains only `.dbt/leases/` |

`security find-generic-password -s com.dbt.licensing` found no keychain item. No compile output or `logs/dbt.log` line mentions a licence or trial.

**What this establishes:** on this machine, with `dbt login status` reporting unauthenticated, strict analysis took effect in every run. That held with the real HOME and with an empty one, with remote licence fetch skipped, and with a backdated install date.

**What it does not establish:** whether this is intended (a trial or grace window), a gap in 2.0.6, or behaviour that a later release or a network call will change. The `DBT_CLIENT_INSTALL_DATE` values may not be in the format the binary expects. For the extension this is a product risk: the shipped plan depends on strict. It should detect a fall-back to baseline at run time rather than assume strict is available. See the plan's open questions.

## 3. Writing column lineage

Every result in this section comes from runs where strict was set with the flag (`--static-analysis strict`), which section 1 shows is effective.

| Claim                                                                                                                                                                                                                                                                                                                                      | Evidence                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `dbt compile --static-analysis strict --generate-info-schema` writes `target/private/metadata/compile/column_lineage/v1_0.parquet` and `target/info_schema/v1/dbt.column_lineage.parquet`, 32 rows                                                                                                                                         | c1/02                                                |
| The same compile without `--generate-info-schema` writes neither                                                                                                                                                                                                                                                                           | c1/04                                                |
| `--generate-info-schema` under baseline or off writes the info schema but no lineage, with warning `dbt1000 … column types will not be populated without --static-analysis strict`                                                                                                                                                         | c1/06, 08                                            |
| `compile`, `build` and `run` wrote lineage with both flags; `parse` and `list` did not, including with `DBT_ENGINE_STATIC_ANALYSIS=strict` (they have no `--static-analysis` flag)                                                                                                                                                         | c2/02–17 (rerun 2026-09-26 with the documented name) |
| `FUSION_POWER_USER_SCHEMA_ORIGIN=remote` with a source table dropped fell back to `static_analysis: off` for the dependent model (dbt1014); `local` did not                                                                                                                                                                                | c5/11, c5/13                                         |
| No `dbt lsp` flag tried made the server write lineage. Tried: `--generate-info-schema`, `--info-schema-dir`, `--target-path`, `--metadata-dir`, `--write-json`, `--write-catalog`, `--selector`, `-s`, state and defer flags, and `--static-analysis strict` in every session. Nor did any `initializationOptions` variant or notification | lsp-flags l1–l4, l7; lsp-protocol P1, P5             |
| With a CLI-written lineage file present, the server did not rewrite it after edit and save                                                                                                                                                                                                                                                 | lsp-flags l7; lsp-protocol P5 step 04 snapshots      |

## 4. Refreshing one edited model

After a full strict compile and an edit to `order_totals`, with parent `stg_orders` never built in the warehouse:

- **`-s order_totals`:** produced `RemoteError (dbt1014): Failed to download model schema for 'model.lineage_probe.stg_orders'. Setting 'static_analysis' to off`, and `order_totals` lineage did not change (s1a, s2).
- **`-s +order_totals`:** refreshed it with no dbt1014 (s1a, s1c, e6/05). The docs describe this effect: unselected parents are read from the warehouse, and a model is eligible for analysis only if all of its upstream dependencies are.
- **Parent built by `dbt run -s stg_orders`:** `-s order_totals` refreshed it (s1d, s2).
- **Defer and state flags:** `--defer`, `--state`, `--favor-state`, `--no-defer`, `--manage-state` and `--no-manage-state` did not avoid dbt1014 when the parent was not built (s2, s2b).
- **Not established:** after a selective compile, which models the `column_lineage` view holds. It varied with the preceding steps (cli-select-state items 5–7, E6).

## 5. Reading lineage

- **Clean read:** `dbt show --profiles-dir <P> --info column_lineage --output json --limit -1 --quiet` printed one JSON array line with an empty stderr, in about 80 ms wall clock (r1/28, r5).
- **Without `--quiet`:** stdout also carries the version banner and the execution summary (r1/31–34).
- **`--log-format json` or `otel`:** stdout carries log events even with `--quiet` (r2/07–12).
- **Filtering and joins:** `--inline` over `{{ info_schema('column_lineage') }}` accepted WHERE, IN, joins to `{{ info_schema('node_columns') }}` and `WITH RECURSIVE` (r3).
- **What it reads:** `show --info` read `target/private/metadata/`. It succeeded with the DuckDB file moved away (r6) and with `target/info_schema/` deleted (r7/18, 21).
- **No metadata** (before any compile, after `dbt clean`, or with a non-matching `--target-path`): exit 1, `InfoSchemaUnavailable (dbt1656)` (r7).
- **Ambiguous empty result:** after a compile without `--generate-info-schema`, the read gave exit 0 and `[]` (r7/06).
- **Reading the parquet directly** returned the same 32 rows and lineage columns (r8).
- **The language server's `dbt.show`** rejected `{{ info_schema('column_lineage') }}` with "not available to a parse-time check" (lsp-protocol P4).

## 6. Native editor features

- **Through VS Code** 1.128.0, `vscode-languageclient` 10.1.1 and this extension, with `fusionPowerUser.staticAnalysis: strict`:
  - hover on `*`, a column and an alias returned results;
  - definition of a column returned the upstream model;
  - references of alias `total` returned `order_totals.sql` and `totals_downstream.sql`;
  - rename of alias `total` edited both files;
  - renaming a non-alias column returned `Cannot rename a column that is not an alias.`;
  - `vscode.prepareRename` returned the word range;
  - Fusion returned no code lenses.

  With `baseline`, every column call returned empty (native-editor-vscode run 1 and run 2 evidence JSON).
- **Through a raw client with `--static-analysis strict`:** the same results, except that `textDocument/prepareRename` returned `No such method` (E3, lsp-flags l6).

## Superseded premises

These claims in earlier documents are wrong or unsupported, and nothing below may be cited:

- **"`DBT_STATIC_ANALYSIS=strict` alone did not enable the features" (lsp-flags l5/61).** That run set the legacy name on the language server. The language server has no env binding for `--static-analysis`, and the documented CLI name is `DBT_ENGINE_STATIC_ANALYSIS`. Section 1 replaces this.
- **Experiments that set `DBT_GENERATE_INFO_SCHEMA`, `DBT_INFO_SCHEMA_DIR` or `DBT_METADATA_DIR`** (cli-compile c1/14–18, c3; lsp-flags l5). The docs list no environment variable for `generate_info_schema` or `info_schema_dir`, and the source's alias list does not include them. What those runs show is how undocumented variables happen to behave in this binary, not a supported configuration.
- **Experiments that set `DBT_TARGET_PATH`, `DBT_PROFILES_DIR` or `DBT_STATE` under their legacy names.** The documented names are `DBT_ENGINE_TARGET_PATH`, `DBT_ENGINE_PROFILES_DIR` and `DBT_ENGINE_STATE`. The legacy names are read after aliasing, but they are not the supported interface.
- **The static-analysis signal.** Using lineage rows (`--generate-info-schema`) as the only signal of static-analysis mode conflated two settings. Section 1 uses dbt0227, which does not depend on the info schema.
- **"Strict requires `dbt login`, but it worked, so the harness must be wrong."** Section 2 records that strict did take effect unauthenticated. That is a finding to track, not a harness error.

## Not established

- Whether strict without authentication in 2.0.6 is intended.
- Why `DBT_STATIC_ANALYSIS=baseline` together with `DBT_ENGINE_STATIC_ANALYSIS=strict` gave strict (M1 step 07).
- Whether `flags: static_analysis` in `dbt_project.yml` is meant to work (M1 step 11).
- The rule for which models the `column_lineage` view holds after a selective compile.
- Any adapter other than DuckDB, remote schema origin through the language server, and projects larger than four models.
