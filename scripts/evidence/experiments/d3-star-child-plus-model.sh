# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# D3: after order_totals gains `biggest`, does a `select *` child (totals_star) get a `biggest` lineage row from
# `compile -s +order_totals`, and from `-s +order_totals+`? Parent stg_orders is never built (the on-save path).
# "Reaches" means `show --info column_lineage` has a row with child totals_star and child_column_name biggest.
# Decision rule, fixed before running: reaches after `+order_totals` → keep `+<model>`; reaches only after
# `+order_totals+` → use `+<model>+`; reaches after neither → record it and keep `+<model>`.
# HOME is a fresh dir under the output root.
mkdir -p "$EVIDENCE_OUT/home"
with FUSION_POWER_USER_SCHEMA_ORIGIN=local HOME="$EVIDENCE_OUT/home"
set_model totals_star "select * from {{ ref('order_totals') }}"
# case_star <label> <selection args...>: fresh target, full compile, edit, selective compile, lineage.
case_star() {
  local label="$1"
  shift
  reset_target
  set_model order_totals "$ORDER_TOTALS_ORIG"
  record "$label-full" dbtp compile --static-analysis strict --generate-info-schema
  lineage "$label-l0"
  set_model order_totals "$ORDER_TOTALS_EDIT"
  record "$label-compile" dbtp compile "$@" --static-analysis strict --generate-info-schema
  lineage "$label-l1"
}
case_star up -s +order_totals
case_star both -s +order_totals+
