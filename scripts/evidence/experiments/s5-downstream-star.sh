# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# S5: after editing order_totals, which selective compile makes a `select *` child (totals_star) show `biggest`:
# -s order_totals+, -s +order_totals, or -s order_totals totals_star? Parent stg_orders is built first.
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
set_model totals_star "select * from {{ ref('order_totals') }}"
# case_ds <label> <selection args...>: fresh target, run all (so every parent exists), full compile, edit,
# selective compile, lineage.
case_ds() {
  local label="$1"
  shift
  reset_target
  set_model order_totals "$ORDER_TOTALS_ORIG"
  record "$label-run" dbtp run
  record "$label-full" dbtp compile --static-analysis strict --generate-info-schema
  lineage "$label-l0"
  set_model order_totals "$ORDER_TOTALS_EDIT"
  record "$label-compile" dbtp compile "$@" --static-analysis strict --generate-info-schema
  lineage "$label-l1"
}
case_ds down -s order_totals+
case_ds up -s +order_totals
case_ds pair -s order_totals totals_star
case_ds star-only -s totals_star
case_ds name -s order_totals
