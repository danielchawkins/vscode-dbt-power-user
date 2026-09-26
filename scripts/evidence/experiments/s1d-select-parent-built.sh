# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# S1d: with every model built first (`dbt run`, so no dbt1014), which of -s order_totals, path:, state:modified,
# state:modified+ and --selector ot_only refresh order_totals' lineage, and what does the view hold after each?
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
record write-selectors /bin/sh -c 'printf "%s\n" "selectors:" \
  "  - name: ot_only" "    definition: {method: fqn, value: order_totals}" > selectors.yml && cat selectors.yml'
case_sel() {
  local label="$1"
  shift
  reset_target
  set_model order_totals "$ORDER_TOTALS_ORIG"
  record "$label-run" dbtp run
  record "$label-full" dbtp compile --static-analysis strict --generate-info-schema
  save_target "$label-pre"
  set_model order_totals "$ORDER_TOTALS_EDIT"
  record "$label-compile" dbtp compile "$@" --static-analysis strict --generate-info-schema
  lineage "$label-l1"
}
case_sel name -s order_totals
case_sel path -s path:models/order_totals.sql
case_sel state-mod -s state:modified --state "$EVIDENCE_OUT/targets/state-mod-pre"
case_sel state-mod-plus -s state:modified+ --state "$EVIDENCE_OUT/targets/state-mod-plus-pre"
case_sel selector-only --selector ot_only
case_sel plus-name -s +order_totals
