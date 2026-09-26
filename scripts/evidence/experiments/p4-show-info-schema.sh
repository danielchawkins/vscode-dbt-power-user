# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# P4: can dbt.show run info_schema('column_lineage') or info_schema('models'), with or without a prior CLI compile or --generate-info-schema?
with FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1
args=(--project-dir "$EVIDENCE_PROJECT" --profiles-dir "$EVIDENCE_PROJECT" --lint-enabled false
  --static-analysis strict --no-version-check --command-prefix "" --log-level-file trace)
lsp show-no-compile protocol/show-info-schema.json "${args[@]}" --otel-file-name p4-a-otel.jsonl
reset_target
lsp show-no-compile-gis protocol/show-info-schema.json "${args[@]}" --generate-info-schema \
  --otel-file-name p4-b-otel.jsonl
reset_target
record cli-compile-gis dbtp compile --static-analysis strict --generate-info-schema
lsp show-after-compile protocol/show-info-schema.json "${args[@]}" --otel-file-name p4-c-otel.jsonl
lsp show-after-compile-gis protocol/show-info-schema.json "${args[@]}" --generate-info-schema \
  --otel-file-name p4-d-otel.jsonl
# The CLI reading the same view, for contrast.
record cli-show-column-lineage dbtp show --info column_lineage --output json --limit 5 --quiet
record cli-show-inline-column-lineage dbtp show --inline "select * from {{ info_schema('column_lineage') }}" \
  --output json --limit 5 --quiet
