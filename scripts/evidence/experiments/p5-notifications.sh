# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# P5: which compiles run and which target/ files change for each notification a client can send after load?
with FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1
args=(--project-dir "$EVIDENCE_PROJECT" --profiles-dir "$EVIDENCE_PROJECT" --lint-enabled false
  --static-analysis strict --no-version-check --command-prefix "" --log-level-file trace)
lsp notifications protocol/notifications.json "${args[@]}" --otel-file-name p5-a-otel.jsonl
# Same sequence on a target/ that already holds a CLI compile with the info schema.
reset_target
set_model order_totals "$ORDER_TOTALS_ORIG"
record cli-compile-gis dbtp compile --static-analysis strict --generate-info-schema
lsp notifications-after-compile protocol/notifications.json "${args[@]}" --generate-info-schema \
  --otel-file-name p5-b-otel.jsonl
