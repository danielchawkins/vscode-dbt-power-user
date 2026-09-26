# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# S4: what do `dbt state --help` and `dbt state explain` report before and after compiles, and do --manage-state /
# --no-manage-state on `compile` change which files are written or whether a selective compile refreshes lineage?
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
cat > "$EVIDENCE_PROJECT/macros/drop_stg_orders.sql" << 'SQL'
{% macro drop_stg_orders() %}
  {% do run_query("drop view if exists main.stg_orders") %}
  {% do run_query("drop table if exists main.stg_orders") %}
{% endmacro %}
SQL
record state-help dbtp state --help
record state-explain-empty dbtp state explain
record state-explain-empty-v dbtp state explain -v
record full dbtp compile --static-analysis strict --generate-info-schema
lineage l0
record state-explain-after-full dbtp state explain -v
set_model order_totals "$ORDER_TOTALS_EDIT"
record state-explain-after-edit dbtp state explain -v
record state-explain-after-edit-sel dbtp state explain -v -s order_totals
record compile-plus-ot dbtp compile -s +order_totals --static-analysis strict --generate-info-schema
lineage l1
record state-explain-after-sel dbtp state explain -v
record run-parent dbtp run -s stg_orders
record state-explain-after-run dbtp state explain -v

# --manage-state vs --no-manage-state, each from a fresh target with the parent absent from the warehouse.
for mode in manage-state no-manage-state; do
  reset_target
  record "$mode-drop-parent" dbtp run-operation drop_stg_orders
  set_model order_totals "$ORDER_TOTALS_ORIG"
  record "$mode-full" dbtp compile "--$mode" --static-analysis strict --generate-info-schema
  lineage "$mode-l0"
  set_model order_totals "$ORDER_TOTALS_EDIT"
  record "$mode-compile-ot" dbtp compile "--$mode" -s order_totals --static-analysis strict --generate-info-schema
  lineage "$mode-l1"
  record "$mode-compile-plus-ot" dbtp compile "--$mode" -s +order_totals --static-analysis strict --generate-info-schema
  lineage "$mode-l2"
  record "$mode-state-explain" dbtp state explain -v
done
