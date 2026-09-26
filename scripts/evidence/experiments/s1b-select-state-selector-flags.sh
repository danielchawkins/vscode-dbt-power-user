# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# S1b: after a full strict compile and an edit to order_totals (parent stg_orders never built), do state:modified,
# --selector, --exclude, --resource-type and --indirect-selection on `compile` refresh order_totals' lineage?
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
# case_sel <label> <selection args...>: fresh target, full compile, lineage, save target as <label>-pre, edit, list,
# selective compile, lineage. Args may reference "$EVIDENCE_OUT/targets/<label>-pre".
case_sel() {
  local label="$1"
  shift
  reset_target
  set_model order_totals "$ORDER_TOTALS_ORIG"
  record "$label-full" dbtp compile --static-analysis strict --generate-info-schema
  lineage "$label-l0"
  save_target "$label-pre"
  set_model order_totals "$ORDER_TOTALS_EDIT"
  record "$label-ls" dbtp list "$@"
  record "$label-compile" dbtp compile "$@" --static-analysis strict --generate-info-schema
  lineage "$label-l1"
}
record write-selectors /bin/sh -c 'printf "%s\n" "selectors:" \
  "  - name: ot_only" "    definition: {method: fqn, value: order_totals}" \
  "  - name: ot_up" "    definition: {method: fqn, value: order_totals, parents: true}" > selectors.yml && cat selectors.yml'
case_sel state-mod -s state:modified --state "$EVIDENCE_OUT/targets/state-mod-pre"
case_sel state-mod-plus -s state:modified+ --state "$EVIDENCE_OUT/targets/state-mod-plus-pre"
case_sel selector-only --selector ot_only
case_sel selector-up --selector ot_up
case_sel exclude-hard --exclude hard
case_sel plus-exclude-parent -s +order_totals --exclude stg_orders
case_sel rtype-model --resource-type model
case_sel indirect-eager -s order_totals --indirect-selection eager
case_sel indirect-cautious -s order_totals --indirect-selection cautious
case_sel indirect-buildable -s order_totals --indirect-selection buildable
case_sel indirect-empty -s order_totals --indirect-selection empty
