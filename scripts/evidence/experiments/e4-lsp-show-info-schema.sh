# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# E4: can the LSP's own dbt.show command read the info schema (after a CLI compile wrote it)?
with FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1
record cli-compile-full dbtp compile --static-analysis strict --generate-info-schema
lsp lsp-show lsp-show-info-schema.json \
  --project-dir "$EVIDENCE_PROJECT" --profiles-dir "$EVIDENCE_PROJECT" --lint-enabled false \
  --static-analysis strict --generate-info-schema --no-version-check --command-prefix "" \
  --log-level-file trace --otel-file-name lsp-show-otel.jsonl
