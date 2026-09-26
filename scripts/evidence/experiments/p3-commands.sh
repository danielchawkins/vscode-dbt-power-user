# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# P3: which argument shape does each advertised workspace/executeCommand command accept, and what does it return?
with FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1
# Models materialized so dbt.show on a model can return rows.
record cli-run dbtp run
reset_target
lsp commands-shapes protocol/commands-shapes.json \
  --project-dir "$EVIDENCE_PROJECT" --profiles-dir "$EVIDENCE_PROJECT" --lint-enabled false \
  --static-analysis strict --no-version-check --command-prefix "" \
  --log-level-file trace --otel-file-name p3-shapes-otel.jsonl
reset_target
lsp commands-prefixed protocol/commands-prefixed.json \
  --project-dir "$EVIDENCE_PROJECT" --profiles-dir "$EVIDENCE_PROJECT" --lint-enabled false \
  --static-analysis strict --no-version-check --command-prefix dbt \
  --log-level-file trace --otel-file-name p3-prefixed-otel.jsonl
