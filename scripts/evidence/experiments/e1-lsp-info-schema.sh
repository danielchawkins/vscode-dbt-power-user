# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# E1: dbt lsp alone. Strict analysis, info schema requested, local sources, trace + OTEL logs. No CLI compile.
# Question: does the LSP write target/info_schema (column lineage) on load, edit, save or its own compile commands?
with FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1
lsp lsp-edit-save edit-and-save.json \
  --project-dir "$EVIDENCE_PROJECT" --profiles-dir "$EVIDENCE_PROJECT" --lint-enabled false \
  --static-analysis strict --generate-info-schema --no-version-check --command-prefix "" \
  --log-level trace --log-level-file trace --otel-file-name lsp-otel.jsonl
record show-info-after-lsp dbtp show --info column_lineage --output json --limit -1 --quiet
