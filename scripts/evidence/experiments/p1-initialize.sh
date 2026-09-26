# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# P1: does initializationOptions or any client capability change the server's capabilities, load behaviour, or files written?
record grep-init /bin/sh -c "/usr/bin/strings -n 8 \"\$0\" | /usr/bin/grep -iE 'initializationOptions|init_options|generate_info_schema|column_lineage|dbt\\.(show|compile|list|get|clear)[A-Za-z]*' | /usr/bin/sort -u | /usr/bin/head -200" "$DBT_BIN"
with FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1
for v in baseline opts-empty opts-generate-info-schema opts-static-analysis opts-snake \
  caps-empty caps-no-progress caps-no-dynreg caps-no-configuration; do
  reset_target
  lsp "init-$v" "protocol/init-$v.json" \
    --project-dir "$EVIDENCE_PROJECT" --profiles-dir "$EVIDENCE_PROJECT" --lint-enabled false \
    --static-analysis strict --no-version-check --command-prefix "" \
    --log-level-file trace --otel-file-name "p1-$v-otel.jsonl"
done
# Server flag, for contrast with the initializationOptions variants.
reset_target
lsp init-flag-generate-info-schema protocol/init-baseline.json \
  --project-dir "$EVIDENCE_PROJECT" --profiles-dir "$EVIDENCE_PROJECT" --lint-enabled false \
  --static-analysis strict --generate-info-schema --no-version-check --command-prefix "" \
  --log-level-file trace --otel-file-name p1-flag-gis-otel.jsonl
