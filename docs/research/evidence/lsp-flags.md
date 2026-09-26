# dbt lsp flags and env vars vs column lineage (Fusion 2.0.6)

> **Run record only.** Superseded by [README.md](README.md), the consolidated evidence. Where this file names `DBT_STATIC_ANALYSIS`, `DBT_GENERATE_INFO_SCHEMA`, `DBT_INFO_SCHEMA_DIR`, `DBT_METADATA_DIR` or `DBT_TARGET_PATH` as configuration, it used legacy or undocumented names; see README "Superseded premises". The experiments that tested only those names (`c3`, `l5`) have been deleted.

Reproducible sessions against `dbt lsp` from dbt Fusion 2.0.6 (`<dbt>` =
`/Users/daniel/.local/share/mise/installs/aqua-getdbt-com-dbt-fusion/2.0.6/dbt`, sha256
`9fc5cd633558235a5eb4e265b5fea2aa8dbb4eb803a5e13872e6e80a5bbd4c15`, `dbt 2.0.6`, Darwin 25.5.0 arm64, node
v24.21.0). Fixture: `scripts/evidence/fixture` (duckdb, four models, three sources, sources
`schema_origin` driven by `FUSION_POWER_USER_SCHEMA_ORIGIN`). Everything below is "in this fixture with this
binary".

## Question

Does any documented `dbt lsp` flag or relevant env var make the server write column lineage (to
`target/info_schema`, `target/.lsp/info_schema`, or `--info-schema-dir`), and which flags are necessary vs
incidental for the server to load the project and answer strict-mode requests?

## How to reproduce

```sh
scripts/evidence/experiments/l-run-all.sh                      # all seven, into $TMPDIR/fpu-ev/lsp-flags
DBT_BIN=<dbt> scripts/evidence/run.sh l1-baseline "$TMPDIR/fpu-ev/lsp-flags"   # one experiment
node scripts/evidence/experiments/l-report.mjs "$TMPDIR/fpu-ev/lsp-flags"/l*/   # the tables below
node scripts/evidence/experiments/l-facts.mjs "$TMPDIR/fpu-ev/lsp-flags"/l*/    # hashes, methods, progress
```

| Experiment                       | Question                                                                                                                                                                                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `l1-baseline.sh`                 | Baseline edit/save session writes lineage anywhere?                                                                                                                                                                                                                    |
| `l2-output-flags.sh`             | `--info-schema-dir`, `--target-path`, `--metadata-dir`, `--write-json`, `--write-catalog`, `--otel-parquet-file-name`                                                                                                                                                  |
| `l3-selection-flags.sh`          | `--selector` (selectors.yml written in step `02-write-selectors`), `-s order_totals`, `-s +order_totals`, `--exclude hard`, `--resource-type model`                                                                                                                    |
| `l4-state-exec-log-flags.sh`     | `--state/--defer true/--favor-state true` (state = copy of a strict CLI compile's target), `--no-defer`, `--manage-state`, `--no-manage-state`, `--dirty`, `--threads 1`, `--vars '{}'`, `--compute inline/sidecar/service`, `--log-format json`, `--quiet`, `--debug` |
| `l5-env-vars.sh`                 | `DBT_GENERATE_INFO_SCHEMA` true/false/env-only, `DBT_LSP_USE_TARGET_LSP` unset/0, `DBT_INFO_SCHEMA_DIR`, `DBT_TARGET_PATH`, `DBT_METADATA_DIR`, `DBT_STATIC_ANALYSIS=strict` instead of the flag                                                                       |
| `l6-static-analysis-features.sh` | `editor-features.json` under strict, strict without `--generate-info-schema`, baseline, off, unsafe                                                                                                                                                                    |
| `l7-shared-cli-target.sh`        | Strict CLI compile first, then LSP with `--target-path target`, `DBT_LSP_USE_TARGET_LSP` unset and `=1`                                                                                                                                                                |

Shared pieces: `experiments/l-common.sh` (`session`, `fresh`), `experiments/l-transcript-notes.mjs`,
`experiments/l-report.mjs`, `experiments/l-facts.mjs`, `experiments/l-run-all.sh`. No new step files; sessions
use the existing `steps/edit-and-save.json` (L1–L5, L7) and `steps/editor-features.json` (L6).

Every session (`session` in `l-common.sh`):

- runs after `fresh` (delete `target/` and `logs/`, restore `models/order_totals.sql`), except L7's sessions,
  which run on top of the CLI compile;
- server argv is always `<dbt> lsp --socket <port> --project-dir <P> --profiles-dir <P> --no-version-check
  --command-prefix "" --log-level-file trace --otel-file-name <label>-otel.jsonl` plus the "Extra argv"
  column; cwd `<P>`; env is run.sh's clean base env (`HOME PATH TERM=dumb DBT_PROFILES_DIR
  DBT_ENGINE_PROFILES_DIR DBT_SEND_ANONYMOUS_USAGE_STATS=false`) plus the "Extra env" column;
- is followed, in order, by: `find-lineage` (`/usr/bin/find target -name '*lineage*'`),
  `find-outside-target`, `transcript-notes`, `grep-logs`, `lineage` (`dbt show --info column_lineage
  --output json --limit -1 --quiet`), `lineage-lsp-target` (same with `--target-path target/.lsp`); these
  run with env `FUSION_POWER_USER_SCHEMA_ORIGIN=local` only;
- copies `logs/` to `<run>/session-logs/<label>/`. Because `fresh` deletes `logs/`, each session's
  `dbt-lsp.log` holds only that session.

Log grep command (step `NN-<label>-grep-logs`, cwd `<P>`, verbatim):

```sh
/bin/sh -c 'for f in logs/*; do
for p in lineage info_schema ArtifactWritten column_lineage; do
printf "%s\t%s\t%s\n" "$(/usr/bin/grep -c -- "$p" "$f")" "$p" "$f"; done
printf "%s\t%s\t%s\n" "$(/usr/bin/grep -- lineage "$f" | /usr/bin/grep -vc lineage_probe)" "lineage-not-lineage_probe" "$f"
done'
```

Column key for the tables: "Analyzing / Background ends" = count of `$/progress` `end` messages with message
`Analyzing` / `Background Analyzing` in `lsp-transcript.jsonl`; "Final error diags" = severity-1 diagnostics in
the last `publishDiagnostics` per URI; "Files under target/" = directories (relative to `target/`) × file count
from the session's `files-after.txt`; "find lineage" = stdout of `find-lineage`; LSP results abbreviations
H hover, D definition, R references, PR prepareRename, RN rename, CL codeLens, IH inlayHint; "object" = a
non-null non-array result, "N loc" = array of N, "error -32601/-32803" = JSON-RPC error code.

## Sessions

Run root `$TMPDIR/fpu-ev/lsp-flags`; the step dir is `<run>/steps/<Step dir>`; project `<P>` is
`<run>/project`.

### l1-baseline

Run `$TMPDIR/fpu-ev/lsp-flags/l1-baseline`, 2026-09-26T14:44:46Z, harness `sumkmyplpolm 40324db5059a`.

| Step dir      | Extra argv                                        | Extra env                                                        | Exit | Analyzing / Background ends | Final error diags | Files under target/ | find lineage                       | lineage (default)                     | lineage (target/.lsp) | grep -c (dbt-lsp.log; otel) | LSP results |
| ------------- | ------------------------------------------------- | ---------------------------------------------------------------- | ---- | --------------------------- | ----------------- | ------------------- | ---------------------------------- | ------------------------------------- | --------------------- | --------------------------- | ----------- |
| `02-baseline` | `--static-analysis strict --generate-info-schema` | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows        | 21/0/0/0/0; 139/0/0/0/0     | R1          |

Other steps:

- `01-setup-warehouse` exit 0: `<dbt> run-operation --profiles-dir <P> setup_raw`

otel `Invocation.eval_args` set per session: `02-baseline` S1.

### l2-output-flags

Run `$TMPDIR/fpu-ev/lsp-flags/l2-output-flags`, 2026-09-26T14:45:25Z, harness `sumkmyplpolm ea92509f6161`.

| Step dir             | Extra argv                                                                                  | Extra env                                                        | Exit | Analyzing / Background ends | Final error diags | Files under target/ | find lineage                       | lineage (default)                     | lineage (target/.lsp) | grep -c (dbt-lsp.log; otel) | LSP results |
| -------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---- | --------------------------- | ----------------- | ------------------- | ---------------------------------- | ------------------------------------- | --------------------- | --------------------------- | ----------- |
| `02-info-schema-dir` | `--static-analysis strict --generate-info-schema --info-schema-dir <P>/alt-is`              | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows        | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `10-target-path`     | `--static-analysis strict --generate-info-schema --target-path alt-tp`                      | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows        | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `20-metadata-dir`    | `--static-analysis strict --generate-info-schema --metadata-dir <P>/alt-md`                 | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows        | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `28-write-json`      | `--static-analysis strict --generate-info-schema --write-json`                              | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows        | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `35-write-catalog`   | `--static-analysis strict --generate-info-schema --write-catalog`                           | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows        | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `42-otel-parquet`    | `--static-analysis strict --generate-info-schema --otel-parquet-file-name otel-lsp.parquet` | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows        | 21/0/0/0/0; 139/0/0/0/0     | R1          |

Other steps:

- `01-setup-warehouse` exit 0: `<dbt> run-operation --profiles-dir <P> setup_raw`
- `09-info-schema-dir-read` exit 1, env `FUSION_POWER_USER_SCHEMA_ORIGIN=local`: `<dbt> show --profiles-dir <P> --info-schema-dir <P>/alt-is --info column_lineage --output json --limit -1 --quiet` → exit 1, InfoSchemaUnavailable dbt1656
- `17-target-path-read` exit 1, env `FUSION_POWER_USER_SCHEMA_ORIGIN=local`: `<dbt> show --profiles-dir <P> --target-path alt-tp --info column_lineage --output json --limit -1 --quiet` → exit 1, InfoSchemaUnavailable dbt1656
- `18-target-path-read-lsp` exit 1, env `FUSION_POWER_USER_SCHEMA_ORIGIN=local`: `<dbt> show --profiles-dir <P> --target-path alt-tp/.lsp --info column_lineage --output json --limit -1 --quiet` → exit 1, InfoSchemaUnavailable dbt1656
- `19-target-path-files` exit 0, env `FUSION_POWER_USER_SCHEMA_ORIGIN=local`: `/usr/bin/find alt-tp -type f` → no paths
- `27-metadata-dir-files` exit 1, env `FUSION_POWER_USER_SCHEMA_ORIGIN=local`: `/usr/bin/find alt-md -type f` → no paths

otel `Invocation.eval_args` set per session: `02-info-schema-dir` S1, `10-target-path` S1, `20-metadata-dir` S1, `28-write-json` S1, `35-write-catalog` S1, `42-otel-parquet` S1.

### l3-selection-flags

Run `$TMPDIR/fpu-ev/lsp-flags/l3-selection-flags`, 2026-09-26T14:49:13Z, harness `sumkmyplpolm 4bf1f8307d5c`.

| Step dir                 | Extra argv                                                              | Extra env                                                        | Exit | Analyzing / Background ends | Final error diags | Files under target/ | find lineage                       | lineage (default)                     | lineage (target/.lsp) | grep -c (dbt-lsp.log; otel) | LSP results |
| ------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------- | ---- | --------------------------- | ----------------- | ------------------- | ---------------------------------- | ------------------------------------- | --------------------- | --------------------------- | ----------- |
| `03-selector`            | `--static-analysis strict --generate-info-schema --selector ot`         | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 3 / 3                       | 0                 | F2                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows        | 15/0/0/0/0; 97/0/0/0/0      | R1          |
| `10-select-order-totals` | `--static-analysis strict --generate-info-schema -s order_totals`       | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows        | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `17-select-upstream`     | `--static-analysis strict --generate-info-schema -s +order_totals`      | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows        | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `24-exclude-hard`        | `--static-analysis strict --generate-info-schema --exclude hard`        | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows        | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `31-resource-type-model` | `--static-analysis strict --generate-info-schema --resource-type model` | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows        | 21/0/0/0/0; 139/0/0/0/0     | R1          |

Other steps:

- `01-setup-warehouse` exit 0: `<dbt> run-operation --profiles-dir <P> setup_raw`
- `02-write-selectors` exit 0: `/bin/sh -c <script in command.txt>`

otel `Invocation.eval_args` set per session: `03-selector` S2, `10-select-order-totals` S1, `17-select-upstream` S1, `24-exclude-hard` S1, `31-resource-type-model` S3.

### l4-state-exec-log-flags

Run `$TMPDIR/fpu-ev/lsp-flags/l4-state-exec-log-flags`, 2026-09-26T14:52:21Z, harness `sumkmyplpolm 71e2a70ecda6`.

| Step dir               | Extra argv                                                                                              | Extra env                                                        | Exit | Analyzing / Background ends | Final error diags | Files under target/ | find lineage                       | lineage (default)                     | lineage (target/.lsp) | grep -c (dbt-lsp.log; otel) | LSP results |
| ---------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---- | --------------------------- | ----------------- | ------------------- | ---------------------------------- | ------------------------------------- | --------------------- | --------------------------- | ----------- |
| `04-state-defer-favor` | `--static-analysis strict --generate-info-schema --state <P>/state-cli --defer true --favor-state true` | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows        | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `11-no-defer`          | `--static-analysis strict --generate-info-schema --no-defer`                                            | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows        | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `18-manage-state`      | `--static-analysis strict --generate-info-schema --manage-state`                                        | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows        | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `25-no-manage-state`   | `--static-analysis strict --generate-info-schema --no-manage-state`                                     | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows        | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `32-dirty`             | `--static-analysis strict --generate-info-schema --dirty`                                               | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows        | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `39-threads-1`         | `--static-analysis strict --generate-info-schema --threads 1`                                           | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows        | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `46-vars-empty`        | `--static-analysis strict --generate-info-schema --vars {}`                                             | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows        | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `53-compute-inline`    | `--static-analysis strict --generate-info-schema --compute inline`                                      | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows        | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `60-compute-sidecar`   | `--static-analysis strict --generate-info-schema --compute sidecar`                                     | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows        | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `67-compute-service`   | `--static-analysis strict --generate-info-schema --compute service`                                     | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows        | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `74-log-format-json`   | `--static-analysis strict --generate-info-schema --log-format json`                                     | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows        | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `81-quiet`             | `--static-analysis strict --generate-info-schema --quiet`                                               | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows        | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `88-debug`             | `--static-analysis strict --generate-info-schema --debug`                                               | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows        | 21/0/0/0/0; 139/0/0/0/0     | R1          |

Other steps:

- `01-setup-warehouse` exit 0: `<dbt> run-operation --profiles-dir <P> setup_raw`
- `02-cli-compile-for-state` exit 0, env `FUSION_POWER_USER_SCHEMA_ORIGIN=local`: `<dbt> compile --profiles-dir <P> --static-analysis strict --generate-info-schema --otel-file-name cli-compile-otel.jsonl`
- `03-state-cli-files` exit 0, env `FUSION_POWER_USER_SCHEMA_ORIGIN=local`: `/usr/bin/find state-cli -type f` → 61 paths
- `06-state-defer-favor-find-outside-target` exit 0, env `FUSION_POWER_USER_SCHEMA_ORIGIN=local`: `/usr/bin/find . -path ./target -prune -o ( -name *lineage* -o -name *info_schema* -o -name *.parquet ) -print` → 52 paths
- `13-no-defer-find-outside-target` exit 0, env `FUSION_POWER_USER_SCHEMA_ORIGIN=local`: `/usr/bin/find . -path ./target -prune -o ( -name *lineage* -o -name *info_schema* -o -name *.parquet ) -print` → 52 paths
- `20-manage-state-find-outside-target` exit 0, env `FUSION_POWER_USER_SCHEMA_ORIGIN=local`: `/usr/bin/find . -path ./target -prune -o ( -name *lineage* -o -name *info_schema* -o -name *.parquet ) -print` → 52 paths
- `27-no-manage-state-find-outside-target` exit 0, env `FUSION_POWER_USER_SCHEMA_ORIGIN=local`: `/usr/bin/find . -path ./target -prune -o ( -name *lineage* -o -name *info_schema* -o -name *.parquet ) -print` → 52 paths
- `34-dirty-find-outside-target` exit 0, env `FUSION_POWER_USER_SCHEMA_ORIGIN=local`: `/usr/bin/find . -path ./target -prune -o ( -name *lineage* -o -name *info_schema* -o -name *.parquet ) -print` → 52 paths
- `41-threads-1-find-outside-target` exit 0, env `FUSION_POWER_USER_SCHEMA_ORIGIN=local`: `/usr/bin/find . -path ./target -prune -o ( -name *lineage* -o -name *info_schema* -o -name *.parquet ) -print` → 52 paths
- `48-vars-empty-find-outside-target` exit 0, env `FUSION_POWER_USER_SCHEMA_ORIGIN=local`: `/usr/bin/find . -path ./target -prune -o ( -name *lineage* -o -name *info_schema* -o -name *.parquet ) -print` → 52 paths
- `55-compute-inline-find-outside-target` exit 0, env `FUSION_POWER_USER_SCHEMA_ORIGIN=local`: `/usr/bin/find . -path ./target -prune -o ( -name *lineage* -o -name *info_schema* -o -name *.parquet ) -print` → 52 paths
- `62-compute-sidecar-find-outside-target` exit 0, env `FUSION_POWER_USER_SCHEMA_ORIGIN=local`: `/usr/bin/find . -path ./target -prune -o ( -name *lineage* -o -name *info_schema* -o -name *.parquet ) -print` → 52 paths
- `69-compute-service-find-outside-target` exit 0, env `FUSION_POWER_USER_SCHEMA_ORIGIN=local`: `/usr/bin/find . -path ./target -prune -o ( -name *lineage* -o -name *info_schema* -o -name *.parquet ) -print` → 52 paths
- `76-log-format-json-find-outside-target` exit 0, env `FUSION_POWER_USER_SCHEMA_ORIGIN=local`: `/usr/bin/find . -path ./target -prune -o ( -name *lineage* -o -name *info_schema* -o -name *.parquet ) -print` → 52 paths
- `83-quiet-find-outside-target` exit 0, env `FUSION_POWER_USER_SCHEMA_ORIGIN=local`: `/usr/bin/find . -path ./target -prune -o ( -name *lineage* -o -name *info_schema* -o -name *.parquet ) -print` → 52 paths
- `90-debug-find-outside-target` exit 0, env `FUSION_POWER_USER_SCHEMA_ORIGIN=local`: `/usr/bin/find . -path ./target -prune -o ( -name *lineage* -o -name *info_schema* -o -name *.parquet ) -print` → 52 paths

otel `Invocation.eval_args` set per session: `04-state-defer-favor` S1, `11-no-defer` S1, `18-manage-state` S1, `25-no-manage-state` S1, `32-dirty` S1, `39-threads-1` S1, `46-vars-empty` S1, `53-compute-inline` S1, `60-compute-sidecar` S1, `67-compute-service` S1, `74-log-format-json` S1, `81-quiet` S1, `88-debug` S1.

### l5-env-vars

Run `$TMPDIR/fpu-ev/lsp-flags/l5-env-vars`, 2026-09-26T15:00:29Z, harness `sumkmyplpolm 38201cf0deac`.

| Step dir                  | Extra argv                                        | Extra env                                                                                       | Exit | Analyzing / Background ends | Final error diags | Files under target/ | find lineage                       | lineage (default)                     | lineage (target/.lsp)                 | grep -c (dbt-lsp.log; otel) | LSP results |
| ------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---- | --------------------------- | ----------------- | ------------------- | ---------------------------------- | ------------------------------------- | ------------------------------------- | --------------------------- | ----------- |
| `02-gis-true`             | `--static-analysis strict --generate-info-schema` | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1 DBT_GENERATE_INFO_SCHEMA=true`  | 0    | 3 / 3                       | 0                 | F3                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows                        | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `09-gis-false`            | `--static-analysis strict --generate-info-schema` | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1 DBT_GENERATE_INFO_SCHEMA=false` | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows                        | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `16-gis-env-only`         | `--static-analysis strict`                        | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1 DBT_GENERATE_INFO_SCHEMA=true`  | 0    | 3 / 3                       | 0                 | F3                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows                        | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `23-use-target-lsp-unset` | `--static-analysis strict --generate-info-schema` | `FUSION_POWER_USER_SCHEMA_ORIGIN=local`                                                         | 0    | 3 / 3                       | 0                 | F4                  | target/compiled/lineage_probe      | exit 0, 0 rows                        | exit 1, InfoSchemaUnavailable dbt1656 | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `30-use-target-lsp-0`     | `--static-analysis strict --generate-info-schema` | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=0`                                | 0    | 3 / 3                       | 0                 | F4                  | target/compiled/lineage_probe      | exit 0, 0 rows                        | exit 1, InfoSchemaUnavailable dbt1656 | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `37-env-info-schema-dir`  | `--static-analysis strict --generate-info-schema` | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1 DBT_INFO_SCHEMA_DIR=<P>/alt-is` | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows                        | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `45-env-target-path`      | `--static-analysis strict --generate-info-schema` | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1 DBT_TARGET_PATH=alt-tp`         | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows                        | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `53-env-metadata-dir`     | `--static-analysis strict --generate-info-schema` | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1 DBT_METADATA_DIR=<P>/alt-md`    | 0    | 3 / 3                       | 0                 | F1                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows                        | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `61-env-static-analysis`  | `--generate-info-schema`                          | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1 DBT_STATIC_ANALYSIS=strict`     | 0    | 3 / 3                       | 0                 | F5                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 1, InfoSchemaUnavailable dbt1656 | 21/0/0/0/0; 139/0/0/0/0     | R2          |

Other steps:

- `01-setup-warehouse` exit 0: `<dbt> run-operation --profiles-dir <P> setup_raw`
- `44-env-info-schema-dir-read` exit 1, env `FUSION_POWER_USER_SCHEMA_ORIGIN=local`: `<dbt> show --profiles-dir <P> --info-schema-dir <P>/alt-is --info column_lineage --output json --limit -1 --quiet` → exit 1, InfoSchemaUnavailable dbt1656
- `52-env-target-path-files` exit 1, env `FUSION_POWER_USER_SCHEMA_ORIGIN=local`: `/usr/bin/find alt-tp -type f` → no paths
- `60-env-metadata-dir-files` exit 1, env `FUSION_POWER_USER_SCHEMA_ORIGIN=local`: `/usr/bin/find alt-md -type f` → no paths

otel `Invocation.eval_args` set per session: `02-gis-true` S1, `09-gis-false` S1, `16-gis-env-only` S1, `23-use-target-lsp-unset` S1, `30-use-target-lsp-0` S1, `37-env-info-schema-dir` S1, `45-env-target-path` S4, `53-env-metadata-dir` S1, `61-env-static-analysis` S1.

### l6-static-analysis-features

Run `$TMPDIR/fpu-ev/lsp-flags/l6-static-analysis-features`, 2026-09-26T15:06:08Z, harness `sumkmyplpolm f4a0ca8d1303`.

| Step dir                  | Extra argv                                          | Extra env                                                        | Exit | Analyzing / Background ends | Final error diags | Files under target/ | find lineage                       | lineage (default)                     | lineage (target/.lsp)                 | grep -c (dbt-lsp.log; otel) | LSP results |
| ------------------------- | --------------------------------------------------- | ---------------------------------------------------------------- | ---- | --------------------------- | ----------------- | ------------------- | ---------------------------------- | ------------------------------------- | ------------------------------------- | --------------------------- | ----------- |
| `02-editor-strict`        | `--static-analysis strict --generate-info-schema`   | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 1 / 1                       | 0                 | F6                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows                        | 10/0/0/0/0; 76/0/0/0/0      | R3          |
| `09-editor-strict-no-gis` | `--static-analysis strict`                          | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 1 / 1                       | 0                 | F6                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows                        | 10/0/0/0/0; 76/0/0/0/0      | R3          |
| `16-editor-baseline`      | `--static-analysis baseline --generate-info-schema` | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 1 / 1                       | 0                 | F5                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 1, InfoSchemaUnavailable dbt1656 | 10/0/0/0/0; 76/0/0/0/0      | R4          |
| `23-editor-off`           | `--static-analysis off --generate-info-schema`      | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 1 / 1                       | 0                 | F5                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 1, InfoSchemaUnavailable dbt1656 | 10/0/0/0/0; 60/0/0/0/0      | R5          |
| `30-editor-unsafe`        | `--static-analysis unsafe --generate-info-schema`   | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 1 / 1                       | 1                 | F6                  | target/.lsp/compiled/lineage_probe | exit 1, InfoSchemaUnavailable dbt1656 | exit 0, 0 rows                        | 10/0/0/0/0; 76/0/0/0/0      | R3          |

Other steps:

- `01-setup-warehouse` exit 0: `<dbt> run-operation --profiles-dir <P> setup_raw`

otel `Invocation.eval_args` set per session: `02-editor-strict` S1, `09-editor-strict-no-gis` S1, `16-editor-baseline` S1, `23-editor-off` S1, `30-editor-unsafe` S1.

### l7-shared-cli-target

Run `$TMPDIR/fpu-ev/lsp-flags/l7-shared-cli-target`, 2026-09-26T15:07:18Z, harness `sumkmyplpolm 9f8f70c4e881`.

| Step dir                 | Extra argv                                                             | Extra env                                                        | Exit | Analyzing / Background ends | Final error diags | Files under target/ | find lineage                                                                                                                                                        | lineage (default)                                              | lineage (target/.lsp)                 | grep -c (dbt-lsp.log; otel) | LSP results |
| ------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------- | ---- | --------------------------- | ----------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------- | --------------------------- | ----------- |
| `04-shared-target-unset` | `--static-analysis strict --generate-info-schema --target-path target` | `FUSION_POWER_USER_SCHEMA_ORIGIN=local`                          | 0    | 3 / 3                       | 0                 | F7                  | target/compiled/lineage_probe, target/info_schema/v1/dbt.column_lineage.parquet, target/private/metadata/compile/column_lineage                                     | exit 0, 32 rows (ingested_at 2026-09-26T08:07:19.910601-07:00) | exit 1, InfoSchemaUnavailable dbt1656 | 21/0/0/0/0; 139/0/0/0/0     | R1          |
| `13-shared-target-1`     | `--static-analysis strict --generate-info-schema --target-path target` | `FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1` | 0    | 3 / 3                       | 0                 | F8                  | target/.lsp/compiled/lineage_probe, target/compiled/lineage_probe, target/info_schema/v1/dbt.column_lineage.parquet, target/private/metadata/compile/column_lineage | exit 0, 32 rows (ingested_at 2026-09-26T08:08:08.179071-07:00) | exit 0, 0 rows                        | 21/0/0/0/0; 139/0/0/0/0     | R1          |

Other steps:

- `01-setup-warehouse` exit 0: `<dbt> run-operation --profiles-dir <P> setup_raw`
- `02-cli-compile-unset` exit 0, env `FUSION_POWER_USER_SCHEMA_ORIGIN=local`: `<dbt> compile --profiles-dir <P> --static-analysis strict --generate-info-schema --otel-file-name cli-compile-unset-otel.jsonl`
- `03-lineage-before-unset` exit 0, env `FUSION_POWER_USER_SCHEMA_ORIGIN=local`: `<dbt> show --profiles-dir <P> --info column_lineage --output json --limit -1 --quiet` → exit 0, 32 rows (ingested_at 2026-09-26T08:07:19.910601-07:00)
- `11-cli-compile-1` exit 0, env `FUSION_POWER_USER_SCHEMA_ORIGIN=local`: `<dbt> compile --profiles-dir <P> --static-analysis strict --generate-info-schema --otel-file-name cli-compile-1-otel.jsonl`
- `12-lineage-before-1` exit 0, env `FUSION_POWER_USER_SCHEMA_ORIGIN=local`: `<dbt> show --profiles-dir <P> --info column_lineage --output json --limit -1 --quiet` → exit 0, 32 rows (ingested_at 2026-09-26T08:08:08.179071-07:00)

otel `Invocation.eval_args` set per session: `04-shared-target-unset` S1, `13-shared-target-1` S1.

#### Files under target/ sets

- F1: .lsp/compiled/lineage_probe/models×8, .lsp/private/metadata/compile/schemas×5
- F2: .lsp/compiled/lineage_probe/models×4, .lsp/private/metadata/compile/schemas×5
- F3: .lsp/compiled/lineage_probe/models×8, .lsp/private/metadata/compile/schemas×5, .lsp/private/metadata/parse×4, .lsp/private/metadata/parse/columns×1, .lsp/private/metadata/parse/nodes×2
- F4: compiled/lineage_probe/models×8, private/metadata/compile/schemas×5
- F5: .lsp/compiled/lineage_probe/models×8
- F6: .lsp/compiled/lineage_probe/models×8, .lsp/private/metadata/compile/schemas×2
- F7: compiled/lineage_probe/models×8, info_schema/v1×39, target×3, private/metadata/compile/column_lineage×1, private/metadata/compile/columns×1, private/metadata/compile/nodes×1, private/metadata/compile/schemas×6, private/metadata/parse×4, private/metadata/parse/columns×1, private/metadata/parse/nodes×1, private/metadata/run/invocations×1
- F8: .lsp/compiled/lineage_probe/models×8, .lsp/private/metadata/compile/schemas×5, compiled/lineage_probe/models×8, info_schema/v1×39, target×3, private/metadata/compile/column_lineage×1, private/metadata/compile/columns×1, private/metadata/compile/nodes×1, private/metadata/compile/schemas×1, private/metadata/parse×4, private/metadata/parse/columns×1, private/metadata/parse/nodes×1, private/metadata/run/invocations×1

#### LSP result sets

- R1: dbt.compileLsp []: null; dbt.compileFile [uri]: object; H new column biggest: hover
- R2: dbt.compileLsp []: null; dbt.compileFile [uri]: object; H new column biggest: null
- R3: H star stg_orders: hover; H passthrough customer_id: hover; H alias total: hover; H ref stg_orders: hover; D passthrough customer_id: object; D downstream total: object; D join key o.customer_id: object; D group-by key: null; R alias total: 2 loc; R passthrough customer_id: 2 loc; R star stg_orders: 2 loc; PR alias total: error -32601; RN alias total: 2 edits; RN downstream use of total: 2 edits; RN passthrough customer_id: error -32803; RN alias label (hard.sql): 1 edits; CL order_totals: null; IH stg_orders: null
- R4: H star stg_orders: null; H passthrough customer_id: null; H alias total: null; H ref stg_orders: hover; D passthrough customer_id: null; D downstream total: null; D join key o.customer_id: null; D group-by key: null; R alias total: null; R passthrough customer_id: null; R star stg_orders: null; PR alias total: error -32601; RN alias total: null; RN downstream use of total: null; RN passthrough customer_id: null; RN alias label (hard.sql): null; CL order_totals: null; IH stg_orders: null
- R5: H star stg_orders: null; H passthrough customer_id: null; H alias total: null; H ref stg_orders: hover; D passthrough customer_id: null; D downstream total: null; D join key o.customer_id: null; D group-by key: null; R alias total: null; R passthrough customer_id: null; R star stg_orders: null; PR alias total: error -32601; RN alias total: null; RN downstream use of total: null; RN passthrough customer_id: null; RN alias label (hard.sql): null; CL order_totals: 1 loc; IH stg_orders: null

#### otel `Invocation.eval_args` sets

- S1: `{"command":"compile","debug":false,"exclude_resource_types":["test","unit_test"],"limit":"10","log_format":"default","manage_state":false,"quiet":false,"target":"dev","vars":"{}","write_catalog":false,"write_json":false}` · `{"command":"compile","debug":false,"exclude_resource_types":["test","unit_test"],"limit":"10","log_format":"default","manage_state":false,"quiet":false,"vars":"{}","write_catalog":false,"write_json":false}` · `{"debug":false,"log_format":"default","manage_state":false,"quiet":false,"vars":"{}","write_catalog":false,"write_json":false}`
- S2: `{"command":"compile","debug":false,"exclude_resource_types":["test","unit_test"],"limit":"10","log_format":"default","manage_state":false,"quiet":false,"selector":"ot","target":"dev","vars":"{}","write_catalog":false,"write_json":false}` · `{"command":"compile","debug":false,"exclude_resource_types":["test","unit_test"],"limit":"10","log_format":"default","manage_state":false,"quiet":false,"selector":"ot","vars":"{}","write_catalog":false,"write_json":false}` · `{"debug":false,"log_format":"default","manage_state":false,"quiet":false,"vars":"{}","write_catalog":false,"write_json":false}`
- S3: `{"command":"compile","debug":false,"exclude_resource_types":["test","unit_test"],"limit":"10","log_format":"default","manage_state":false,"quiet":false,"resource_types":["model"],"target":"dev","vars":"{}","write_catalog":false,"write_json":false}` · `{"command":"compile","debug":false,"exclude_resource_types":["test","unit_test"],"limit":"10","log_format":"default","manage_state":false,"quiet":false,"resource_types":["model"],"vars":"{}","write_catalog":false,"write_json":false}` · `{"debug":false,"log_format":"default","manage_state":false,"quiet":false,"vars":"{}","write_catalog":false,"write_json":false}`
- S4: `{"command":"compile","debug":false,"exclude_resource_types":["test","unit_test"],"limit":"10","log_format":"default","manage_state":false,"quiet":false,"target":"dev","target_path":"alt-tp","vars":"{}","write_catalog":false,"write_json":false}` · `{"command":"compile","debug":false,"exclude_resource_types":["test","unit_test"],"limit":"10","log_format":"default","manage_state":false,"quiet":false,"target_path":"alt-tp","vars":"{}","write_catalog":false,"write_json":false}` · `{"debug":false,"log_format":"default","manage_state":false,"quiet":false,"vars":"{}","write_catalog":false,"write_json":false}`

## Cross-session facts

From `l-facts.mjs` (reads `NN-<label>-transcript-notes/stdout.txt` and `files-after.txt`):

- Server→client notification/request methods. Every `edit-and-save.json` session (L1–L5, L7) and the
  baseline/off editor sessions: `$/progress`, `client/registerCapability`, `dbt/lspBackgroundCompileComplete`,
  `dbt/lspBackgroundCompileStart`, `dbt/lspCompileComplete`, `dbt/lspCompileStart`,
  `textDocument/publishDiagnostics`, `window/logMessage`, `window/workDoneProgress/create`,
  `workspace/codeLens/refresh`, `workspace/configuration`, `workspace/semanticTokens/refresh`. The strict and
  unsafe editor sessions (`02-editor-strict`, `09-editor-strict-no-gis`, `30-editor-unsafe`) add
  `dbt/renameColumn`. None of these names contains "lineage" or "info_schema".
- `$/progress` titles seen. `edit-and-save.json` sessions: begin title `""` (end message `Analyzing` or
  `Background Analyzing`), and title `"Compiling File"` (end with no message). `editor-features.json`
  sessions: title `""` (`Analyzing`, `Background Analyzing`), `"Finding All References"`, `"Renaming"`.
  Every progress token that began also ended.
- `03-selector` sent 259 server messages vs 271 for the other `edit-and-save.json` sessions, and compiled 2
  models (F2) instead of 4.
- `30-editor-unsafe` is the only session with a final error diagnostic:
  `dbt_project.yml: [DeprecatedStaticAnalysisValue (dbt1703)]: --static-analysis unsafe is deprecated and will
  be removed in May, 2026. Use --static-analysis strict instead.`
- `61-env-static-analysis` (`DBT_STATIC_ANALYSIS=strict` in env, no flag) wrote no
  `private/metadata/compile/schemas` (F5, same as baseline/off) and hover on `biggest` returned `null` (R2),
  where every strict-flag `edit-and-save.json` session returned
  `| Alias | Type |\n| :--- | :--- |\n| biggest | decimal(10, 2) |` (R1, e.g.
  `l1-baseline/steps/02-baseline/lsp-results.json`).
- Grep sensitivity control (same grep, run by hand afterwards in `l7-shared-cli-target/project`, file
  `logs/cli-compile-1-otel.jsonl` from step `11-cli-compile-1`): `46 lineage`, `0 lineage-not-lineage_probe`,
  `0 info_schema`, `4 ArtifactWritten`, `0 column_lineage`. The 4 `ArtifactWritten` events have
  `relative_path` `target/compiled/lineage_probe/models/{hard,order_totals,stg_orders,totals_downstream}.sql`.
  So a strict CLI compile that did write `target/info_schema/v1/dbt.column_lineage.parquet` also logs 0
  `info_schema` / `column_lineage` matches: a zero in these greps is not evidence that nothing was written. The
  LSP sessions' 0 `ArtifactWritten` (vs 4 for the CLI) does show the server emits no `ArtifactWritten` events
  at all, even for the compiled SQL it does write.

### L7: lineage files before/after (sha256 prefix, size, mtime from `files-after.txt`)

| Step                                               | `target/info_schema/v1/dbt.column_lineage.parquet` | `target/private/metadata/compile/column_lineage/v1_0.parquet` | `dbt show --info column_lineage`                                  |
| -------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| `02-cli-compile-unset` → `03-lineage-before-unset` | `964af5f0f828` 1976 B 08:07:20                     | `cdc7791d7817` 2658 B 08:07:20                                | 32 rows, order_totals 6, `biggest` 0, ingested_at 08:07:19.910601 |
| after `04-shared-target-unset` → `09-…-lineage`    | `964af5f0f828` 1976 B 08:07:20                     | `cdc7791d7817` 2658 B 08:07:20                                | 32 rows, order_totals 6, `biggest` 0, ingested_at 08:07:19.910601 |
| `11-cli-compile-1` → `12-lineage-before-1`         | `28ff8fb873f2` 1980 B 08:08:08                     | `5a74897dafaf` 2658 B 08:08:08                                | 32 rows, order_totals 6, `biggest` 0, ingested_at 08:08:08.179071 |
| after `13-shared-target-1` → `18-…-lineage`        | `28ff8fb873f2` 1980 B 08:08:08                     | `5a74897dafaf` 2658 B 08:08:08                                | 32 rows, order_totals 6, `biggest` 0, ingested_at 08:08:08.179071 |

In `04-shared-target-unset` the server rewrote `target/compiled/lineage_probe/models/order_totals.sql` (sha
`8eb954e1810b` 137 B → `b3d6da35bd60` 161 B, i.e. the edited SQL with `biggest`) in the CLI's target, and
left both lineage parquet files byte-identical. In `13-shared-target-1` it wrote to `target/.lsp/` instead
and did not touch `target/compiled/`.

## Summary table

| Variation (step)                                                                                          | Loaded? (Analyzing ends / final error diags) | Lineage written? where?                                                                                                            | Strict features answered?                     |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Baseline (`l1/02-baseline`)                                                                               | yes (3 / 0)                                  | no; `target/.lsp/private/metadata/compile/schemas` only; `.lsp` read 0 rows                                                        | hover on `biggest`: yes                       |
| `--info-schema-dir <P>/alt-is` (`l2/02`)                                                                  | yes (3 / 0)                                  | no; nothing under `alt-is` (find outside target: none; read dbt1656)                                                               | yes                                           |
| `--target-path alt-tp` (`l2/10`)                                                                          | yes (3 / 0)                                  | no; `alt-tp` not created; still wrote `target/.lsp`                                                                                | yes                                           |
| `--metadata-dir <P>/alt-md` (`l2/20`)                                                                     | yes (3 / 0)                                  | no; `alt-md` not created                                                                                                           | yes                                           |
| `--write-json` / `--write-catalog` (`l2/28`, `l2/35`)                                                     | yes (3 / 0)                                  | no; no JSON artifacts; eval_args `write_json:false`, `write_catalog:false`                                                         | yes                                           |
| `--otel-parquet-file-name` (`l2/42`)                                                                      | yes (3 / 0)                                  | no; no parquet written for it                                                                                                      | yes                                           |
| `--selector ot` (`l3/03`)                                                                                 | yes (3 / 0), 2 models compiled               | no                                                                                                                                 | yes                                           |
| `-s order_totals`, `-s +order_totals`, `--exclude hard` (`l3/10,17,24`)                                   | yes (3 / 0), 4 models compiled               | no                                                                                                                                 | yes                                           |
| `--resource-type model` (`l3/31`)                                                                         | yes (3 / 0)                                  | no                                                                                                                                 | yes                                           |
| `--state … --defer true --favor-state true` (`l4/04`)                                                     | yes (3 / 0)                                  | no                                                                                                                                 | yes                                           |
| `--no-defer`, `--manage-state`, `--no-manage-state`, `--dirty`, `--threads 1`, `--vars '{}'` (`l4/11…46`) | yes (3 / 0)                                  | no                                                                                                                                 | yes                                           |
| `--compute inline/sidecar/service` (`l4/53,60,67`)                                                        | yes (3 / 0)                                  | no                                                                                                                                 | yes                                           |
| `--log-format json`, `--quiet`, `--debug` (`l4/74,81,88`)                                                 | yes (3 / 0)                                  | no                                                                                                                                 | yes                                           |
| `DBT_GENERATE_INFO_SCHEMA=true` (`l5/02`)                                                                 | yes (3 / 0)                                  | no; adds `target/.lsp/private/metadata/parse/*`                                                                                    | yes                                           |
| `DBT_GENERATE_INFO_SCHEMA=false` (`l5/09`)                                                                | yes (3 / 0)                                  | no                                                                                                                                 | yes                                           |
| `DBT_GENERATE_INFO_SCHEMA=true`, no flag (`l5/16`)                                                        | yes (3 / 0)                                  | no; same files as `l5/02`                                                                                                          | yes                                           |
| `DBT_LSP_USE_TARGET_LSP` unset / `=0` (`l5/23,30`)                                                        | yes (3 / 0)                                  | no; writes `target/` not `target/.lsp`; default read 0 rows                                                                        | yes                                           |
| `DBT_INFO_SCHEMA_DIR`, `DBT_TARGET_PATH`, `DBT_METADATA_DIR` (`l5/37,45,53`)                              | yes (3 / 0)                                  | no; alt dirs not created                                                                                                           | yes                                           |
| `DBT_STATIC_ANALYSIS=strict`, no flag (`l5/61`)                                                           | yes (3 / 0)                                  | no; no `compile/schemas` either                                                                                                    | no: hover on `biggest` `null`                 |
| editor, strict (`l6/02`)                                                                                  | yes (1 / 0)                                  | no                                                                                                                                 | hover/definition/references/rename yes (R3)   |
| editor, strict without `--generate-info-schema` (`l6/09`)                                                 | yes (1 / 0)                                  | no                                                                                                                                 | same as strict (R3)                           |
| editor, baseline (`l6/16`)                                                                                | yes (1 / 0)                                  | no                                                                                                                                 | no: only hover on `ref` (R4)                  |
| editor, off (`l6/23`)                                                                                     | yes (1 / 0)                                  | no                                                                                                                                 | no: only hover on `ref`, plus 1 codeLens (R5) |
| editor, unsafe (`l6/30`)                                                                                  | yes (1 / 1: dbt1703 deprecation)             | no                                                                                                                                 | same as strict (R3)                           |
| CLI strict compile, then LSP `--target-path target`, `DBT_LSP_USE_TARGET_LSP` unset (`l7/04`)             | yes (3 / 0)                                  | no update: lineage parquet sha/mtime unchanged, ingested_at unchanged, no `biggest` row; compiled SQL in `target/compiled` updated | yes                                           |
| same with `DBT_LSP_USE_TARGET_LSP=1` (`l7/13`)                                                            | yes (3 / 0)                                  | no update; server wrote `target/.lsp`                                                                                              | yes                                           |

## Necessary vs incidental

All statements are in this fixture with this binary.

- No flag or env var tried made the server write column lineage. In every session `find target -name
  '*lineage*'` found only `compiled/lineage_probe` directories (plus, in L7, the CLI's pre-existing files), the
  `find-outside-target` step found nothing new (in L4 only the copied `state-cli/`), and the `.lsp` read
  returned 0 rows or dbt1656 (all tables above; e.g. `l1-baseline/steps/03-baseline-find-lineage`,
  `08-baseline-lineage-lsp-target`).
- Pre-existing CLI lineage is not refreshed by the server, even when it shares the CLI target: parquet sha256
  prefix, size, mtime and `ingested_at` are identical before and after, and the edited column `biggest` is
  absent, while the server did rewrite `target/compiled/.../order_totals.sql` (`l7-shared-cli-target`
  `03`→`09` and `12`→`18`, table above).
- `--static-analysis strict` (as a flag) is necessary for the native column features: hover on columns,
  definition, references and rename answer under strict (`l6/02-editor-strict`) and not under baseline
  (`l6/16`) or off (`l6/23`), where only hover on the `ref()` target answers. `unsafe` behaves like strict
  plus a dbt1703 deprecation error diagnostic (`l6/30`).
- `DBT_STATIC_ANALYSIS=strict` in the environment is not a substitute for the flag: without the flag the
  server wrote no `compile/schemas` and hover on `biggest` returned `null` (`l5/61-env-static-analysis`).
- `--generate-info-schema` is incidental to strict features: strict without it gave the same R3 results and
  the same F6 files (`l6/09-editor-strict-no-gis` vs `l6/02-editor-strict`). It is also incidental to what
  the server writes: with the flag and without env, files are F1, identical to `DBT_GENERATE_INFO_SCHEMA=false`
  (`l5/09`).
- `DBT_GENERATE_INFO_SCHEMA=true` (with or without the flag) changes what is written: it adds
  `target/.lsp/private/metadata/parse/{*,columns,nodes}` (F3, `l5/02`, `l5/16`), still no column lineage.
- `DBT_LSP_USE_TARGET_LSP=1` is what moves the server's output to `target/.lsp/`; unset or `0` writes to
  `target/` (`l5/23`, `l5/30`, F4). It does not affect loading or features (R1 in both).
- `--target-path`, `--info-schema-dir`, `--metadata-dir` (flags) and `DBT_INFO_SCHEMA_DIR`, `DBT_METADATA_DIR`
  had no visible effect: output stayed in `target/.lsp` and the alternate dirs were not created (`l2/10–27`,
  `l5/37–60`). `DBT_TARGET_PATH=alt-tp` appears as `target_path:"alt-tp"` in the otel eval_args (S4) but
  `alt-tp` was still not created (`l5/52-env-target-path-files`). `--target-path target` (L7) is
  indistinguishable from the default.
- Incidental to loading: `--write-json`, `--write-catalog`, `--otel-parquet-file-name`, `-s`, `--exclude`,
  `--resource-type`, `--state/--defer/--favor-state`, `--no-defer`, `--manage-state`, `--no-manage-state`,
  `--dirty`, `--threads 1`, `--vars '{}'`, `--compute inline|sidecar|service`, `--log-format json`,
  `--quiet`, `--debug`: every one gave exit 0, 3 `Analyzing` ends, 0 error diagnostics, the same files (F1) and
  the same results (R1). The otel `Invocation.eval_args` for these sessions are identical (S1) even for
  flags that have a field there (`write_json`, `write_catalog`, `debug`, `quiet`, `log_format`,
  `manage_state` all stay at their defaults).
- `--selector` is the only flag that changed compilation: 2 of 4 models compiled (F2, `l3/03-selector`), and
  it is the only CLI flag besides `--resource-type` that appears in eval_args (S2, S3).
- Always passed and not varied (so not shown necessary or incidental): `--project-dir`, `--profiles-dir`,
  `--no-version-check`, `--command-prefix ""`, `--log-level-file trace`, `--otel-file-name`, and
  `FUSION_POWER_USER_SCHEMA_ORIGIN=local`.

## Not established

- Whether the server ever writes column lineage under some condition not tried: other step sequences (e.g.
  `dbt.show` with `info_schema()`, other `workspace/executeCommand`s, `didChangeWatchedFiles` for YAML),
  `initializationOptions`, `workspace/configuration` answers other than `{lsp:{linter:{enabled:false}}}`, a
  remote-schema (`FUSION_POWER_USER_SCHEMA_ORIGIN` unset) fixture, other adapters, or a longer wait.
- Whether `--target-path`, `--info-schema-dir` and `--metadata-dir` are parsed and ignored, or overridden by
  the LSP's own target choice: no written file or eval_args field distinguishes the two (except
  `DBT_TARGET_PATH`, which reached eval_args and still had no visible effect).
- Whether `--compute sidecar|service` actually ran anything differently: the fixture's session does no warehouse
  work beyond compile and all outputs matched baseline.
- Whether `--state`/`--defer` influence anything in the LSP: state contained a full strict compile incl.
  `info_schema/v1/dbt.column_lineage.parquet`; nothing observable changed.
- The `.lsp` target's `dbt show --info column_lineage` returning `[]` (exit 0) vs dbt1656 is determined by
  whether `private/metadata/compile/schemas` exists (F1/F3/F6 → 0 rows; F5 → dbt1656). Whether 0 rows means
  "table present but empty" or "no lineage source" was not examined.
- The greps are a weak negative: the control shows a strict CLI compile that wrote column lineage logs 0
  `info_schema`/`column_lineage` matches too. Fusion's logs do not record lineage writes by these names.

## Harness notes

- No harness bug in `run.sh`, `lib.sh`, `lsp-session.mjs` or `summarize.mjs` was changed. Two quirks, worked
  around in the new scripts only:
  - `result.json` splits argv and env at the first `--`; `lsp` steps have a `--` in argv
    (`lsp-session.mjs … -- <dbt> …`), so for LSP steps `result.json`'s `argv` stops before `<dbt>` and its
    `env` holds the dbt argv plus the real env. `command.txt` and `lsp-command.json` are correct;
    `l-report.mjs` reads env from `command.txt`.
  - `edit-and-save.json` rewrites `models/order_totals.sql` on disk, so consecutive sessions in one
    experiment start from the edited SQL unless the model is restored; `fresh` in `l-common.sh` restores it.
- Operational: with several agents sharing VS Code terminals, runs were launched detached via
  `experiments/l-run-all.sh` (nohup) so interrupts in shared shells could not kill them. Earlier L1 attempts
  were interrupted or superseded and are not reported; the reported L1 is the run dated 14:44:46Z.
- `context.txt` records `harness_revision` per experiment; they differ between experiments only because the
  working-copy commit was re-snapshotted as `l-report.mjs`/`l-facts.mjs` were edited during the runs. The
  experiment scripts and `l-common.sh` did not change after the L1 run except for the `grep-logs` step
  (added `column_lineage` and `lineage-not-lineage_probe`), which was in place before the reported runs
  started.
