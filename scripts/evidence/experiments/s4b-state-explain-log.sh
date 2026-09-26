# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# S4b: does `dbt state explain` report anything when pointed at an existing log file with -l (text or JSON log
# format), after a full and a selective compile?
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
record full dbtp compile --static-analysis strict --generate-info-schema --log-level-file trace
record ls-logs /bin/ls -la logs
record explain-log dbtp state explain -v -l logs/dbt.log
set_model order_totals "$ORDER_TOTALS_EDIT"
record compile-plus-ot dbtp compile -s +order_totals --static-analysis strict --generate-info-schema \
  --log-level-file trace
record explain-log-after-sel dbtp state explain -v -l logs/dbt.log
record explain-log-abs dbtp state explain -v -l "$EVIDENCE_PROJECT/logs/dbt.log"
record compile-json-log dbtp compile -s +order_totals --static-analysis strict --generate-info-schema \
  --log-format-file json --log-path json-logs
record ls-json-logs /bin/ls -la json-logs
record explain-json-log dbtp state explain -v -l json-logs/dbt.log
