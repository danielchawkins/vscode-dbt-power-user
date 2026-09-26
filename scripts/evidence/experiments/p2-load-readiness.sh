# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# P2: which server messages signal the project is loaded, and does the Analyzing end agree with getProjectInfo, across repeats?
with FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1
for i in 1 2 3; do
  reset_target
  lsp "load-$i" protocol/init-baseline.json \
    --project-dir "$EVIDENCE_PROJECT" --profiles-dir "$EVIDENCE_PROJECT" --lint-enabled false \
    --static-analysis strict --no-version-check --command-prefix "" \
    --log-level-file trace --otel-file-name "p2-load-$i-otel.jsonl"
done
# initialized without any didOpen: does the server load the project on its own?
reset_target
lsp load-no-open protocol/init-no-open.json \
  --project-dir "$EVIDENCE_PROJECT" --profiles-dir "$EVIDENCE_PROJECT" --lint-enabled false \
  --static-analysis strict --no-version-check --command-prefix "" \
  --log-level-file trace --otel-file-name p2-no-open-otel.jsonl
