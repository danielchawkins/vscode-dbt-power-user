# CLI flags and environment for column lineage: evidence

> **Run record only.** Superseded by [README.md](README.md), the consolidated evidence. Where this file names `DBT_STATIC_ANALYSIS`, `DBT_GENERATE_INFO_SCHEMA`, `DBT_INFO_SCHEMA_DIR`, `DBT_METADATA_DIR` or `DBT_TARGET_PATH` as configuration, it used legacy or undocumented names; see README "Superseded premises". The experiments that tested only those names (`c3`, `l5`) have been deleted.

Captured 2026-09-26 with dbt Fusion 2.0.6 (`<dbt>` = `/Users/daniel/.local/share/mise/installs/aqua-getdbt-com-dbt-fusion/2.0.6/dbt`, sha256 `9fc5cd633558235a5eb4e265b5fea2aa8dbb4eb803a5e13872e6e80a5bbd4c15`) on Darwin 25.5.0 arm64, Node v24.21.0, DuckDB adapter, using the `lineage_probe` fixture in `scripts/evidence/fixture/`. Each experiment was run with:

```sh
DBT_BIN=<dbt> scripts/evidence/run.sh <name> $TMPDIR/fpu-ev/cli-compile
node scripts/evidence/summarize.mjs $TMPDIR/fpu-ev/cli-compile/<name>
```

Step directories are `$TMPDIR/fpu-ev/cli-compile/<name>/steps/<step>/`. `<P>` is the run's project directory (`$TMPDIR/fpu-ev/cli-compile/<name>/project`, canonical `/private/var/...` form) and `<OUT>` is its parent. Every step's base environment is `HOME`, a clean `PATH`, `TERM=dumb`, `DBT_PROFILES_DIR=<P>`, `DBT_ENGINE_PROFILES_DIR=<P>`, `DBT_SEND_ANONYMOUS_USAGE_STATS=false`; the "env+" column lists only what the experiment added. The cwd of every step is `<P>`, except `c4/28`, which is `/bin/sh -c 'cd /tmp && exec …'` and so runs dbt from `/tmp`. Every run starts with `01-setup-warehouse` (`<dbt> run-operation --profiles-dir <P> setup_raw`, exit 0), then deletes `target/` and `logs/`.

"Read" means `L` = `<dbt> show --profiles-dir <P> --info column_lineage --output json --limit -1 --quiet` (the `lineage` helper in `lib.sh`), plus any extra flags shown. Row counts come from `summarize.mjs`, by child model: `hard`, `order_totals` (`ot`), `stg_orders` (`stg`), `totals_downstream` (`td`). In this fixture a full lineage table is 32 rows: hard 19, ot 6, stg 5, td 2. The two lineage files tracked from `files-after.txt` are `IS` = `target/info_schema/v1/dbt.column_lineage.parquet` and `MD` = `target/private/metadata/compile/column_lineage/v1_0.parquet`. Seconds are `ended − started` from `result.json`.

## C1: `--static-analysis` and `--generate-info-schema` on `compile`

Experiment `c1-static-analysis-info-schema`. Each variant runs `reset_target` first, except `j-*`. env+ for every step is `FUSION_POWER_USER_SCHEMA_ORIGIN=local` plus the variables listed; the read steps have only `FUSION_POWER_USER_SCHEMA_ORIGIN=local`.

| Step                         | argv                                                                                 | env+ (besides origin=local)                                | exit | s    | Files after                                                                                   | Read step → rows                     |
| ---------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ---- | ---- | --------------------------------------------------------------------------------------------- | ------------------------------------ |
| 02-a-baseline                | `<dbt> compile --profiles-dir <P> --static-analysis strict --generate-info-schema`   | —                                                          | 0    | 0.42 | IS, MD; 63 files                                                                              | 03 → 32 (hard 19, ot 6, stg 5, td 2) |
| 04-b-strict-no-gis           | `<dbt> compile --profiles-dir <P> --static-analysis strict`                          | —                                                          | 0    | 0.54 | no IS, no MD; 14 files (compiled SQL, manifest, `private/metadata/compile/schemas/0.parquet`) | 05 → 0                               |
| 06-c-sa-baseline-gis         | `<dbt> compile --profiles-dir <P> --static-analysis baseline --generate-info-schema` | —                                                          | 0    | 0.39 | IS (sha `83ab16`), no MD; 60 files                                                            | 07 → 0                               |
| 08-d-sa-off-gis              | `<dbt> compile --profiles-dir <P> --static-analysis off --generate-info-schema`      | —                                                          | 0    | 0.56 | IS, no MD; 60 files                                                                           | 09 → 0                               |
| 10-e-no-sa-flag-gis          | `<dbt> compile --profiles-dir <P> --generate-info-schema`                            | —                                                          | 0    | 0.51 | IS, no MD; 60 files                                                                           | 11 → 0                               |
| 12-f-env-sa-strict-gis       | `<dbt> compile --profiles-dir <P> --generate-info-schema`                            | `DBT_STATIC_ANALYSIS=strict`                               | 0    | 0.51 | IS, MD; 63 files                                                                              | 13 → 32                              |
| 14-g-strict-env-gis-true     | `<dbt> compile --profiles-dir <P> --static-analysis strict`                          | `DBT_GENERATE_INFO_SCHEMA=true`                            | 0    | 0.53 | IS, MD; 63 files                                                                              | 15 → 32                              |
| 16-h-env-gis-false-plus-flag | `<dbt> compile --profiles-dir <P> --static-analysis strict --generate-info-schema`   | `DBT_GENERATE_INFO_SCHEMA=false`                           | 0    | 0.40 | IS, MD; 63 files                                                                              | 17 → 32                              |
| 18-i-env-both                | `<dbt> compile --profiles-dir <P>`                                                   | `DBT_STATIC_ANALYSIS=strict DBT_GENERATE_INFO_SCHEMA=true` | 0    | 0.56 | IS, MD; 63 files                                                                              | 19 → 32                              |

Steps 06, 08 and 10 each print, verbatim, on stderr:

```text
[warning] [Generic (dbt1000)]: --generate-info-schema: column types will not be populated without `--static-analysis strict`, which also enables column-level lineage.
```

No other step in C1 printed a `[warning]` or `[error]` line.

Refresh sequence (no `reset_target` between these steps; `order_totals` is edited to `$ORDER_TOTALS_EDIT` after step 20, which adds `biggest`):

| Step                    | argv                                                                               | exit | s    | IS / MD after (mtime, sha prefix)                                            | Read step → rows, `ingested_at`                                       |
| ----------------------- | ---------------------------------------------------------------------------------- | ---- | ---- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 20-j-baseline           | `<dbt> compile --profiles-dir <P> --static-analysis strict --generate-info-schema` | 0    | 0.55 | IS 07:34:13 `f95b0843`; MD 07:34:13 `5e89be30`                               | —                                                                     |
| 21-j-edit-strict-no-gis | `<dbt> compile --profiles-dir <P> --static-analysis strict`                        | 0    | 0.43 | IS and MD unchanged (same mtime and sha); `manifest.json` rewritten 07:34:15 | 22 → 32, ot 6 (no `biggest`), one `ingested_at` 07:34:12.892          |
| 23-j-edit-strict-gis    | `<dbt> compile --profiles-dir <P> --static-analysis strict --generate-info-schema` | 0    | 0.45 | IS 07:34:18 `44e40c6c`; MD 07:34:18 `2d3e6dca`                               | 24 → 34, ot 8 (includes `biggest` ×2), one `ingested_at` 07:34:18.535 |

## C2: which subcommands write lineage

Experiment `c2-subcommands`. Each step runs after `reset_target`. env+ is `FUSION_POWER_USER_SCHEMA_ORIGIN=local` plus what is listed.

| Step                      | argv                                                                               | env+ (besides origin=local)  | exit | s    | Files after                                                                                       | Read step → rows |
| ------------------------- | ---------------------------------------------------------------------------------- | ---------------------------- | ---- | ---- | ------------------------------------------------------------------------------------------------- | ---------------- |
| 02-a-parse-gis            | `<dbt> parse --profiles-dir <P> --generate-info-schema`                            | —                            | 0    | 0.40 | IS (sha `83ab16`), no MD; 51 files                                                                | 03 → 0           |
| 04-b-parse-gis-env-strict | `<dbt> parse --profiles-dir <P> --generate-info-schema`                            | `DBT_STATIC_ANALYSIS=strict` | 0    | 0.39 | IS (sha `83ab16`), no MD; 51 files                                                                | 05 → 0           |
| 06-c-compile-strict-gis   | `<dbt> compile --profiles-dir <P> --static-analysis strict --generate-info-schema` | —                            | 0    | 0.54 | IS, MD; 63 files                                                                                  | 07 → 32          |
| 08-d-build-strict-gis     | `<dbt> build --profiles-dir <P> --static-analysis strict --generate-info-schema`   | —                            | 0    | 0.53 | IS, MD, and `target/private/index/` (40 files, including `dbt.column_lineage.parquet`); 109 files | 09 → 32          |
| 10-e-run-strict-gis       | `<dbt> run --profiles-dir <P> --static-analysis strict --generate-info-schema`     | —                            | 0    | 0.55 | IS, MD, `target/private/index/`; 109 files                                                        | 11 → 32          |
| 12-f-list-gis             | `<dbt> list --profiles-dir <P> --generate-info-schema`                             | —                            | 0    | 0.50 | no IS, no MD; 11 files (manifest, `private/metadata/parse/*`, `run/invocations`)                  | 13 → 0           |
| 14-g-list-gis-env-strict  | `<dbt> list --profiles-dir <P> --generate-info-schema`                             | `DBT_STATIC_ANALYSIS=strict` | 0    | 0.37 | no IS, no MD; 11 files                                                                            | 15 → 0           |
| 16-h-parse-write-metadata | `<dbt> parse --profiles-dir <P> --write-metadata`                                  | —                            | 0    | 0.51 | no IS, no MD; 10 files (`private/metadata/parse/*`, `compile/columns`, `run/invocations`)         | 17 → 0           |

Steps 02 and 04 print, verbatim:

```text
[warning] [InfoSchemaIncomplete (dbt1658)]: --generate-info-schema: the information schema produced by `parse` is incomplete; column types, column-level lineage, and runtime results are only written by `compile`, `run`, or `build`.
```

`--write-metadata` is not in `/tmp/fpu-help/parse.txt`. Step 16 still exits 0 with no warning, and stdout ends `Finished 'parse' successfully for target 'dev'`. `list` has no `--static-analysis` flag in `dbt list --help`.

## C3: artifact-location flags

Experiment `c3-artifact-locations`, final run after the harness fix described in "Harness notes". Each compile step runs after `target/` and every `alt-*` directory are deleted. Relative directories are relative to `<P>`. `files-after.txt` only covers `target/` and `logs/`, so each compile is followed by a `/usr/bin/find . -type f ( -path ./target/* -o -path ./alt-* ) ( -name *.parquet -o -name *.json )` step (`g-files` uses `/usr/bin/find <OUT>/abs-is -type f`). env+ for every step is `FUSION_POWER_USER_SCHEMA_ORIGIN=local` plus what is listed. Every compile exits 0 and takes 0.4–0.6 s.

| Compile step                     | argv tail after `<dbt> compile --profiles-dir <P> --static-analysis strict --generate-info-schema` | env+                         | Where lineage files landed (find step)                                                                                                                                                                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 02-a-compile-info-schema-dir     | `--info-schema-dir alt-is`                                                                         | —                            | 03: `alt-is/v1/dbt.column_lineage.parquet` (38 files in `alt-is/v1`); `target/private/metadata/compile/column_lineage/v1_0.parquet`; no `target/info_schema`                                                                                                                     |
| 06-b-compile-env-info-schema-dir | (none)                                                                                             | `DBT_INFO_SCHEMA_DIR=alt-is` | 07: same as 03                                                                                                                                                                                                                                                                   |
| 10-c-compile-target-path         | `--target-path alt-target`                                                                         | —                            | 11: `alt-target/info_schema/v1/dbt.column_lineage.parquet`, `alt-target/private/metadata/compile/column_lineage/v1_0.parquet`; `target/` holds no json/parquet (`files-after.txt`: 2 files, both under `logs/`)                                                                  |
| 14-d-compile-env-target-path     | (none)                                                                                             | `DBT_TARGET_PATH=alt-target` | 15: same as 11                                                                                                                                                                                                                                                                   |
| 18-e-compile-metadata-dir        | `--metadata-dir alt-meta`                                                                          | —                            | 19: `alt-meta/compile/column_lineage/v1_0.parquet` (plus `alt-meta/compile` ×3 files, `alt-meta/run` ×1); `target/info_schema/v1/dbt.column_lineage.parquet`; `target/private/metadata/parse/*` ×6 and `target/private/metadata/compile/schemas/0.parquet` still under `target/` |
| 22-f-compile-env-metadata-dir    | (none)                                                                                             | `DBT_METADATA_DIR=alt-meta`  | 23: same as 19                                                                                                                                                                                                                                                                   |
| 26-g-compile-abs-info-schema-dir | `--info-schema-dir <OUT>/abs-is`                                                                   | —                            | 27: `<OUT>/abs-is/v1/dbt.column_lineage.parquet` (39 files); `target/private/metadata/compile/column_lineage/v1_0.parquet`                                                                                                                                                       |

Reads (argv is `L` plus the tail shown):

| Read step              | Extra read flag                  | env+ (besides origin=local)  | exit | Rows                       |
| ---------------------- | -------------------------------- | ---------------------------- | ---- | -------------------------- |
| 04-a-read-default      | —                                | —                            | 0    | 32                         |
| 05-a-read-matching     | `--info-schema-dir alt-is`       | —                            | 0    | 32                         |
| 08-b-read-default      | —                                | —                            | 0    | 32                         |
| 09-b-read-matching-env | —                                | `DBT_INFO_SCHEMA_DIR=alt-is` | 0    | 32                         |
| 12-c-read-default      | —                                | —                            | 1    | not JSON; error below      |
| 13-c-read-matching     | `--target-path alt-target`       | —                            | 0    | 32                         |
| 16-d-read-default      | —                                | —                            | 1    | not JSON; same error as 12 |
| 17-d-read-matching-env | —                                | `DBT_TARGET_PATH=alt-target` | 0    | 32                         |
| 20-e-read-default      | —                                | —                            | 0    | 0                          |
| 21-e-read-matching     | `--metadata-dir alt-meta`        | —                            | 0    | 32                         |
| 24-f-read-default      | —                                | —                            | 0    | 0                          |
| 25-f-read-matching-env | —                                | `DBT_METADATA_DIR=alt-meta`  | 0    | 32                         |
| 28-g-read-default      | —                                | —                            | 0    | 32                         |
| 29-g-read-matching     | `--info-schema-dir <OUT>/abs-is` | —                            | 0    | 32                         |

Steps 12 and 16, verbatim on stderr (path shortened):

```text
[error] [InfoSchemaUnavailable (dbt1656)]: no project metadata at <P>/target/private/metadata — run a command that writes it, such as `dbt build`, `dbt compile`, or `dbt parse --write-metadata`
```

## C4: other flags added to the baseline compile

Experiment `c4-incidental-flags`. Each variant runs `reset_target`, then `<dbt> compile --profiles-dir <P> --static-analysis strict --generate-info-schema <flag>` and then `L` (step label `<variant>-lineage`). env+ for every step is `FUSION_POWER_USER_SCHEMA_ORIGIN=local`.

| Compile step              | Added flag(s)                                                                                                                                                         | exit | s    | IS, MD written                | Files after | Rows (hard/ot/stg/td)        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ----------------------------- | ----------- | ---------------------------- |
| 02-a-baseline             | —                                                                                                                                                                     | 0    | 0.40 | yes, yes                      | 63          | 32 (19/6/5/2)                |
| 04-b-no-write-json        | `--no-write-json`                                                                                                                                                     | 0    | 0.38 | yes, yes                      | 60          | 32 (19/6/5/2)                |
| 06-c-write-json           | `--write-json`                                                                                                                                                        | 0    | 0.51 | yes, yes                      | 63          | 32 (19/6/5/2)                |
| 08-d-write-catalog        | `--write-catalog`                                                                                                                                                     | 0    | 0.91 | yes, yes                      | 64          | 32 (19/6/5/2)                |
| 10-e-threads-1            | `--threads 1`                                                                                                                                                         | 0    | 0.52 | yes, yes                      | 63          | 32 (19/6/5/2)                |
| 12-f-no-version-check     | `--no-version-check`                                                                                                                                                  | 0    | 0.37 | yes, yes                      | 63          | 32 (19/6/5/2)                |
| 14-g-quiet                | `--quiet`                                                                                                                                                             | 0    | 0.50 | yes, yes                      | 63          | 32 (19/6/5/2)                |
| 16-h-log-format-json      | `--log-format json`                                                                                                                                                   | 0    | 0.40 | yes, yes                      | 63          | 32 (19/6/5/2)                |
| 18-i-full-refresh         | `--full-refresh`                                                                                                                                                      | 0    | 0.64 | yes, yes                      | 63          | 32 (19/6/5/2)                |
| 20-j-vars                 | `--vars {probe_var: 1}` (one argv element)                                                                                                                            | 0    | 0.51 | yes, yes                      | 63          | 32 (19/6/5/2)                |
| 22-k-target-dev           | `--target dev`                                                                                                                                                        | 0    | 0.39 | yes, yes                      | 63          | 32 (19/6/5/2)                |
| 24-l-profile              | `--profile lineage_probe`                                                                                                                                             | 0    | 0.52 | yes, yes                      | 63          | 32 (19/6/5/2)                |
| 26-m-project-dir          | `--project-dir <P>`                                                                                                                                                   | 0    | 0.50 | yes, yes                      | 63          | 32 (19/6/5/2)                |
| 28-n-project-dir-from-tmp | argv `/bin/sh -c 'cd /tmp && exec "$0" "$@"' <dbt> compile --project-dir <P> --profiles-dir <P> --static-analysis strict --generate-info-schema`; dbt's cwd is `/tmp` | 0    | 0.38 | yes, yes (under `<P>/target`) | 63          | 29-n-lineage → 32 (19/6/5/2) |

With `--log-format json` (step 16), stdout is JSON lines (the first is `{"data":{"log_version":3,"version":"=2.0.6"},…}`). No step from 02 to 29 printed a `[warning]` or `[error]` line.

`--dirty` sequence (no reset between 30 and 32; `order_totals` edited to `$ORDER_TOTALS_EDIT` after 30; the warehouse holds only the three raw tables, since no model was ever run in this experiment):

| Step                  | argv                                                                                       | exit | s    | Observed                                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------ | ---- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 30-o-baseline         | `<dbt> compile --profiles-dir <P> --static-analysis strict --generate-info-schema`         | 0    | 0.52 | IS `280e616e`, MD `f630c363`                                                                                                                                                                                          |
| 31-o-dirty-after-edit | `<dbt> compile --profiles-dir <P> --static-analysis strict --generate-info-schema --dirty` | 0    | 1.35 | IS rewritten (`18777be8`, 1974→1626 bytes); MD unchanged (`f630c363`, mtime of step 30); new `private/metadata/compile/nodes/v1_1.parquet`, `parse/nodes/v1_1.parquet`, `run/invocations/v1_1.parquet`; warning below |
| 32-o-lineage          | `L`                                                                                        | 0    | 0.1  | 13 rows: ot 6, stg 5, td 2, **no `hard` rows**; one `ingested_at` = 07:35:59.457 (step 30's time)                                                                                                                     |

Step 31, verbatim on stderr:

```text
[warning] [RemoteError (dbt1014)]: Failed to download model schema for 'model.lineage_probe.stg_orders'. Setting 'static_analysis' to off. Skipping analysis for 'model.lineage_probe.order_totals': Catalog Error: Table with name stg_orders does not exist!
Did you mean "orders"?

LINE 1: DESCRIBE "probe"."main"."stg_orders";
```

## C5: `FUSION_POWER_USER_SCHEMA_ORIGIN`

Experiment `c5-schema-origin`. The fixture's `dbt_project.yml` sets `sources: +schema_origin: "{{ env_var('FUSION_POWER_USER_SCHEMA_ORIGIN', 'remote') }}"`. Compile steps run after `reset_target`, with argv `<dbt> compile --profiles-dir <P> --static-analysis strict --generate-info-schema`; each read step (`L`) carries the same env+ as its compile. Step 10 drops `main.contacts` through a new macro, `scripts/evidence/fixture/macros/drop_contacts.sql`.

| Step                | argv                                                   | env+                                     | exit | s    | Observed                                                                          | Read step → rows (hard/ot/stg/td)     |
| ------------------- | ------------------------------------------------------ | ---------------------------------------- | ---- | ---- | --------------------------------------------------------------------------------- | ------------------------------------- |
| 02-a-unset          | compile                                                | —                                        | 0    | 0.52 | IS, MD; 64 files, including `target/private/metadata/warehouse/schemas/0.parquet` | 03 → 32 (19/6/5/2)                    |
| 04-b-remote         | compile                                                | `FUSION_POWER_USER_SCHEMA_ORIGIN=remote` | 0    | 0.40 | IS, MD; 64 files, including `warehouse/schemas/0.parquet`                         | 05 → 32 (19/6/5/2)                    |
| 06-c-local          | compile                                                | `FUSION_POWER_USER_SCHEMA_ORIGIN=local`  | 0    | 0.52 | IS, MD; 63 files, no `warehouse/schemas/0.parquet`                                | 07 → 32 (19/6/5/2)                    |
| 08-d-invalid        | compile                                                | `FUSION_POWER_USER_SCHEMA_ORIGIN=bogus`  | 1    | 0.15 | no IS, no MD; 3 files; error below                                                | 09 → 0 (exit 0)                       |
| 10-e-drop-contacts  | `<dbt> run-operation --profiles-dir <P> drop_contacts` | `…=local`                                | 0    | 0.5  | —                                                                                 | —                                     |
| 11-f-remote-dropped | compile                                                | `FUSION_POWER_USER_SCHEMA_ORIGIN=remote` | 0    | 1.40 | IS, MD; warning below                                                             | 12 → 13 (—/6/5/2), **no `hard` rows** |
| 13-g-local-dropped  | compile                                                | `FUSION_POWER_USER_SCHEMA_ORIGIN=local`  | 0    | 0.51 | IS, MD; no warning                                                                | 14 → 32 (19/6/5/2)                    |
| 15-h-restore        | `<dbt> run-operation --profiles-dir <P> setup_raw`     | `…=local`                                | 0    | 0.4  | —                                                                                 | —                                     |

Step 08, verbatim:

```text
[error] [SerializationError (dbt1013)]: YAML error: sources.+schema_origin: unknown variant `bogus`, expected `remote` or `local`
```

Step 11, verbatim:

```text
[warning] [RemoteError (dbt1014)]: Failed to download source schema for 'source.lineage_probe.raw.contacts'. Setting 'static_analysis' to off. Skipping analysis for 'model.lineage_probe.hard': Catalog Error: Table with name contacts does not exist!
Did you mean "customers"?

LINE 1: DESCRIBE "probe"."main"."contacts";
```

## Necessary vs incidental

All of the following hold in this fixture with this binary, and only for the runs cited.

- Two settings were needed together for lineage rows: strict static analysis and info-schema generation. `compile --static-analysis strict --generate-info-schema` gave 32 rows (c1/02→03). Dropping `--generate-info-schema` gave 0 rows and wrote neither lineage file (c1/04→05). With `--static-analysis baseline`, `off`, or no `--static-analysis` at all, the run still wrote `IS` but not `MD`, printed the dbt1000 warning, and gave 0 rows (c1/06, 08, 10).
- The environment variables worked in place of the flags. `DBT_STATIC_ANALYSIS=strict` replaced `--static-analysis strict` (c1/12→13, 32 rows), `DBT_GENERATE_INFO_SCHEMA=true` replaced `--generate-info-schema` (c1/14→15, 32 rows), and both together with no flags also gave 32 rows (c1/18→19).
- `DBT_GENERATE_INFO_SCHEMA=false` together with `--generate-info-schema` still wrote lineage (32 rows, c1/16→17). The run does not show whether the flag overrides the variable or `false` is simply not read as "off".
- A strict compile without `--generate-info-schema` after an edit did not refresh lineage. `IS` and `MD` kept step 20's mtime and sha, and the read returned the pre-edit `order_totals` rows (c1/21→22). Adding `--generate-info-schema` refreshed them (8 `order_totals` rows including `biggest`, c1/23→24).
- Of the subcommands tried, `compile`, `build` and `run` with `--static-analysis strict --generate-info-schema` wrote lineage (32 rows each; c2/06, 08, 10). `parse --generate-info-schema` wrote `IS` but no `MD`, printed dbt1658 and gave 0 rows, with or without `DBT_STATIC_ANALYSIS=strict` (c2/02, 04). `list --generate-info-schema` wrote neither file and gave 0 rows (c2/12, 14). `parse --write-metadata` was accepted, wrote neither lineage file, and gave 0 rows (c2/16).
- `build` and `run` also wrote `target/private/index/` with its own `dbt.column_lineage.parquet`; `compile` did not (c2/08, 10 vs 06).
- `dbt show --info column_lineage` returned rows whenever `MD` (`…/metadata/compile/column_lineage/v1_0.parquet`) existed at the location show was told to read, whether or not it could see `IS`:
  - `--info-schema-dir` or `DBT_INFO_SCHEMA_DIR` (relative or absolute) moved only the `info_schema/v1/*` files, and a read without the matching flag still returned 32 rows (c3/02→04, 06→08, 26→28). The matching read also returned 32 (c3/05, 09, 29).
  - `--target-path` or `DBT_TARGET_PATH` moved everything. A read without it exited 1 with dbt1656 (c3/12, 16); a read with it returned 32 (c3/13, 17).
  - `--metadata-dir` or `DBT_METADATA_DIR` moved the compile and run metadata, including `MD`, while `IS` stayed in `target/info_schema`. A read without it exited 0 with 0 rows (c3/20, 24); a read with it returned 32 (c3/21, 25).
- None of these changed whether lineage was written or how many rows came back (32 each, c4/02–29): `--no-write-json`, `--write-json`, `--write-catalog`, `--threads 1`, `--no-version-check`, `--quiet`, `--log-format json`, `--full-refresh`, `--vars {probe_var: 1}`, `--target dev`, `--profile lineage_probe`, `--project-dir <P>`, and `--project-dir <P>` from cwd `/tmp`. `--write-catalog` made the compile slower (0.91 s vs 0.37–0.64 s).
- `--dirty` after an edit, with no model built in the warehouse, rewrote `IS` but left `MD` unchanged, warned that static analysis was off for `order_totals`, and the read returned 13 rows with no `hard` rows and step 30's `ingested_at` (c4/31→32). In this setup it did not refresh lineage, and the read lost `hard`, a model the edit did not touch.
- With the fixture warehouse present, `FUSION_POWER_USER_SCHEMA_ORIGIN` unset, `remote` or `local` all gave 32 rows (c5/02, 04, 06). Unset behaved like `remote`: both wrote `private/metadata/warehouse/schemas/0.parquet`, which `local` did not. An invalid value failed the compile with exit 1 and dbt1013, and nothing was written (c5/08).
- With `main.contacts` dropped, `remote` warned (dbt1014), switched static analysis off for `hard`, and the read returned 13 rows without `hard`; the compile still exited 0 (c5/11→12). `local` returned all 32 rows with no warning (c5/13→14).
- Timing: every compile in these runs took 0.37–0.64 s, except `--write-catalog` (0.91 s), `--dirty` (1.35 s), `remote` with a dropped table (1.40 s), and the invalid origin (0.15 s, failed).

## Not established

- Only `--static-analysis`, `--generate-info-schema` and the flags listed in C4 were tried; `--select`/`--exclude` interplay is covered by E6, not here. Not tried: `--partial-parse`/`--partial-load` apart from what `--dirty` implies, `--defer`/`--state`, `--compute`, `--use-v`, `--log-level*`, `--log-path`, `--otel-*`, `--send-anonymous-usage-stats`, `--store-failures`, `--manage-state`/`--no-manage-state`, `--with-sample`/`--sampled`, `--event-time-*`, and the `DBT_*` variables other than those named above.
- Whether `DBT_GENERATE_INFO_SCHEMA=false` on its own disables generation. Only `false` together with the flag was run (c1/16). Nor was it tested whether other spellings (`1`, `TRUE`) are accepted.
- Why `show --info column_lineage` read `MD` rather than `IS`, and whether it ever reads `IS`. The C3 results fit reading `<target>/private/metadata`, but the binary's lookup logic was not inspected. That `IS` differs between the parse/baseline runs (sha `83ab16`) and the strict runs is only a hash difference; `IS` contents were not opened.
- Why the `--dirty` read dropped `hard` while `MD` was unchanged. `private/metadata/*/nodes/v1_1.parquet` files appeared (c4/31), but their contents were not examined. `--dirty` was not tried with the parents built in the warehouse, or with `FUSION_POWER_USER_SCHEMA_ORIGIN=remote` against a built project.
- `--dirty`'s model-schema fetch for `stg_orders` ran with `FUSION_POWER_USER_SCHEMA_ORIGIN=local`. The source-level `schema_origin` did not stop that model lookup, but whether any setting would stop it was not tested.
- `build`/`run` without `--generate-info-schema`, and whether their `target/private/index/dbt.column_lineage.parquet` alone lets `show --info` return rows.
- `--generate-info-schema` combined with `--target-path` and `--info-schema-dir` or `--metadata-dir` at the same time, and reads from a cwd other than `<P>`.
- Row contents beyond counts per child and `ingested_at`, other than the `biggest` rows in c1/24.
- Each configuration was run once in the final runs (C1, C2, C4 and C5 on the first pass, C3 re-run after the harness fix, with the same results as its first pass). Timings are single samples on a machine shared with other agents.
- Any other adapter, project, or dbt version.

## Harness notes

- `run.sh` did not canonicalise the output directory. `EVIDENCE_OUT` kept `$TMPDIR`'s `/var/folders/…/T//…` form (double slash, no `/private`), while `EVIDENCE_PROJECT` was `pwd -P` (`/private/var/…`). Paths an experiment built from `$EVIDENCE_OUT` (c3 step 26) were therefore not shortened to `<P>` or `<OUT>`, and looked unrelated to the project path. `run.sh` now sets `out="$(cd "$out" && pwd -P)"` after creating it; c3 was re-run with the fix.
- `README.md` said `dbt` must be on `PATH`, but `run.sh` requires an absolute `DBT_BIN` and never consults `PATH`. The README now says so.
- `files-after.txt` only covers `target/` and `logs/`, so files written with `--info-schema-dir`, `--target-path` or `--metadata-dir` outside `target/` are invisible to it. C3 adds explicit `find` steps rather than changing `snapshot`.
