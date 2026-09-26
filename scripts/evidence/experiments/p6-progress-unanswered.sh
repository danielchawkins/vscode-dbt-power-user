# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# P6: does the server still load and answer commands when the client never answers window/workDoneProgress/create?
with FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1
lsp progress-unanswered protocol/progress-unanswered.json \
  --project-dir "$EVIDENCE_PROJECT" --profiles-dir "$EVIDENCE_PROJECT" --lint-enabled false \
  --static-analysis strict --no-version-check --command-prefix "" \
  --log-level-file trace --otel-file-name p6-otel.jsonl
