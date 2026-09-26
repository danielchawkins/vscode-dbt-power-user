# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, dbtp, with and EVIDENCE_*.
# C4: do the other common flags change whether `compile --static-analysis strict --generate-info-schema` writes
# column_lineage? Each variant starts from an empty target/ and adds one flag (or one pair) to that baseline.
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
base=(--static-analysis strict --generate-info-schema)
variant() {
  local label="$1"
  shift
  reset_target
  record "$label" dbtp compile "${base[@]}" "$@"
  lineage "$label-lineage"
}

variant a-baseline
variant b-no-write-json --no-write-json
variant c-write-json --write-json
variant d-write-catalog --write-catalog
variant e-threads-1 --threads 1
variant f-no-version-check --no-version-check
variant g-quiet --quiet
variant h-log-format-json --log-format json
variant i-full-refresh --full-refresh
variant j-vars --vars '{probe_var: 1}'
variant k-target-dev --target dev
variant l-profile --profile lineage_probe
variant m-project-dir --project-dir "$EVIDENCE_PROJECT"

# --project-dir from a different cwd (/tmp); the recorded cwd stays the project, the shell cds first.
reset_target
# shellcheck disable=SC2016 # $0/$@ are expanded by the inner /bin/sh.
record n-project-dir-from-tmp /bin/sh -c 'cd /tmp && exec "$0" "$@"' "$DBT_BIN" compile \
  --project-dir "$EVIDENCE_PROJECT" --profiles-dir "$EVIDENCE_PROJECT" "${base[@]}"
lineage n-lineage

# --dirty: baseline, edit one model, recompile with --dirty.
reset_target
record o-baseline dbtp compile "${base[@]}"
set_model order_totals "$ORDER_TOTALS_EDIT"
record o-dirty-after-edit dbtp compile "${base[@]}" --dirty
lineage o-lineage
set_model order_totals "$ORDER_TOTALS_ORIG"
