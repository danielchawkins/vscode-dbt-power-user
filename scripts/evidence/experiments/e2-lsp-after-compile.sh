# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# E2: same LSP session as E1, but on top of a full strict CLI compile that wrote the info schema.
# Question: does the LSP refresh the existing column lineage after an edit/save?
with FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1
record cli-compile-full dbtp compile --static-analysis strict --generate-info-schema \
  --log-level-file trace --otel-file-name cli-compile-otel.jsonl
record show-info-before dbtp show --info column_lineage --output json --limit -1 --quiet
with FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1
lsp lsp-edit-save edit-and-save.json \
  --project-dir "$EVIDENCE_PROJECT" --profiles-dir "$EVIDENCE_PROJECT" --lint-enabled false \
  --static-analysis strict --generate-info-schema --no-version-check --command-prefix "" \
  --log-level trace --log-level-file trace --otel-file-name lsp-otel.jsonl
record show-info-after-lsp dbtp show --info column_lineage --output json --limit -1 --quiet
