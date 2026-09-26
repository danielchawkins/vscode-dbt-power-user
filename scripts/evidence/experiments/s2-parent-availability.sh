# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# S2: for `compile -s order_totals` after an edit, which parent-availability conditions (never built, built by
# `run -s stg_orders`, --defer with/without --state, --favor-state, --no-defer) avoid dbt1014 and refresh lineage?
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
# case_parent <label> <pre-step: none|run-parent> <compile args...>
case_parent() {
  local label="$1" pre="$2"
  shift 2
  reset_target
  set_model order_totals "$ORDER_TOTALS_ORIG"
  record "$label-full" dbtp compile --static-analysis strict --generate-info-schema
  lineage "$label-l0"
  save_target "$label-pre"
  case "$pre" in
    run-parent) record "$label-run-parent" dbtp run -s stg_orders ;;
  esac
  set_model order_totals "$ORDER_TOTALS_EDIT"
  record "$label-compile" dbtp compile -s order_totals "$@" --static-analysis strict --generate-info-schema
  lineage "$label-l1"
}
# Macro to remove stg_orders from the warehouse, so every case starts with it absent.
cat > "$EVIDENCE_PROJECT/macros/drop_stg_orders.sql" << 'SQL'
{% macro drop_stg_orders() %}
  {% do run_query("drop view if exists main.stg_orders") %}
  {% do run_query("drop table if exists main.stg_orders") %}
{% endmacro %}
SQL
case_parent a-never none
case_parent b-run-parent run-parent
record b-drop-parent dbtp run-operation drop_stg_orders
case_parent c-defer-state none --defer --state "$EVIDENCE_OUT/targets/c-defer-state-pre"
case_parent c-defer-state-favor none --defer --state "$EVIDENCE_OUT/targets/c-defer-state-favor-pre" --favor-state true
case_parent c-state-only none --state "$EVIDENCE_OUT/targets/c-state-only-pre"
case_parent d-defer-no-state none --defer
case_parent e-no-defer none --no-defer
