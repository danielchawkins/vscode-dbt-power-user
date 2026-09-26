# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# S1a: after a full strict compile and an edit to order_totals (parent stg_orders never built), which name, graph
# and path selector forms on `compile` refresh order_totals' lineage, and what does the lineage view hold after?
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
# case_sel <label> <selection args...>: fresh target, full compile, lineage, edit, list, selective compile, lineage.
case_sel() {
  local label="$1"
  shift
  reset_target
  set_model order_totals "$ORDER_TOTALS_ORIG"
  record "$label-full" dbtp compile --static-analysis strict --generate-info-schema
  lineage "$label-l0"
  set_model order_totals "$ORDER_TOTALS_EDIT"
  record "$label-ls" dbtp list "$@"
  record "$label-compile" dbtp compile "$@" --static-analysis strict --generate-info-schema
  lineage "$label-l1"
}
case_sel name -s order_totals
case_sel plus-name -s +order_totals
case_sel one-plus-name -s 1+order_totals
case_sel name-plus -s order_totals+
case_sel path -s path:models/order_totals.sql
case_sel no-select
