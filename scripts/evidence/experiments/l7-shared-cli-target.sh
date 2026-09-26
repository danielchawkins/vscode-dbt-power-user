# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh. L7: pre-existing CLI state shared with the server.
# Question: after `dbt compile --static-analysis strict --generate-info-schema` wrote target/info_schema, does an
# LSP session given `--target-path target` (DBT_LSP_USE_TARGET_LSP unset, then =1) update that lineage after
# edit/save? Compare ingested_at and the sha256 prefixes in files-after.txt.
# shellcheck source=scripts/evidence/experiments/l-common.sh
source "$EVIDENCE_HERE/experiments/l-common.sh"
L=(FUSION_POWER_USER_SCHEMA_ORIGIN=local)

for variant in unset 1; do
  fresh
  with "${L[@]}"
  record "cli-compile-$variant" dbtp compile --static-analysis strict --generate-info-schema \
    --otel-file-name "cli-compile-$variant-otel.jsonl"
  lineage "lineage-before-$variant"
  if [[ "$variant" == unset ]]; then
    session shared-target-unset edit-and-save.json "${L[@]}" -- "${L_BASE_FLAGS[@]}" --target-path target
  else
    session shared-target-1 edit-and-save.json "${L_BASE_ENV[@]}" -- "${L_BASE_FLAGS[@]}" --target-path target
  fi
done
