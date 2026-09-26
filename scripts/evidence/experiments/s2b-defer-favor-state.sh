# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# S2b: does `compile` accept --favor-state (valueless) with --defer --state, and does deferring to a state target
# written by a `run` (stg_orders built, then dropped from the warehouse) avoid dbt1014 for `-s order_totals`?
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
cat > "$EVIDENCE_PROJECT/macros/drop_stg_orders.sql" << 'SQL'
{% macro drop_stg_orders() %}
  {% do run_query("drop view if exists main.stg_orders") %}
  {% do run_query("drop table if exists main.stg_orders") %}
{% endmacro %}
SQL
sel() { record "$1" dbtp compile "${@:2}" --static-analysis strict --generate-info-schema; }

sel a-full
save_target a-pre
set_model order_totals "$ORDER_TOTALS_EDIT"
sel a-defer-favor -s order_totals --defer --state "$EVIDENCE_OUT/targets/a-pre" --favor-state
lineage a-l1

reset_target
set_model order_totals "$ORDER_TOTALS_ORIG"
record b-run-all dbtp run
sel b-full
save_target b-pre
record b-drop-parent dbtp run-operation drop_stg_orders
set_model order_totals "$ORDER_TOTALS_EDIT"
sel b-defer-run-state -s order_totals --defer --state "$EVIDENCE_OUT/targets/b-pre"
lineage b-l1
sel b-defer-run-state-favor -s order_totals --defer --state "$EVIDENCE_OUT/targets/b-pre" --favor-state
lineage b-l2
sel b-no-defer -s order_totals
lineage b-l3
