# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# E3: editor features (hover, definition, references, rename, codeLens, inlayHint) across static-analysis modes.
# No CLI compile first. Local sources. Question: which native LSP features answer, per mode?
with FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1
for mode in baseline strict; do
  rm -rf "$EVIDENCE_PROJECT/target"
  lsp "editor-$mode" editor-features.json \
    --project-dir "$EVIDENCE_PROJECT" --profiles-dir "$EVIDENCE_PROJECT" --lint-enabled false \
    --static-analysis "$mode" --no-version-check --command-prefix "" \
    --log-level-file trace --otel-file-name "lsp-editor-$mode-otel.jsonl"
done
