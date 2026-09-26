# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# S1c: is the lineage-view contents after `-s +order_totals`, `--selector ot_up` and `--exclude hard` repeatable,
# and does the mere presence of selectors.yml change it? (s1a and s1b disagreed for the same node set.)
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
case_sel() {
  local label="$1"
  shift
  reset_target
  set_model order_totals "$ORDER_TOTALS_ORIG"
  record "$label-full" dbtp compile --static-analysis strict --generate-info-schema
  set_model order_totals "$ORDER_TOTALS_EDIT"
  record "$label-compile" dbtp compile "$@" --static-analysis strict --generate-info-schema
  lineage "$label-l1"
}
case_sel noyml-plus-1 -s +order_totals
case_sel noyml-exclude-1 --exclude hard
case_sel noyml-plus-2 -s +order_totals
record write-selectors /bin/sh -c 'printf "%s\n" "selectors:" \
  "  - name: ot_up" "    definition: {method: fqn, value: order_totals, parents: true}" > selectors.yml && cat selectors.yml'
case_sel yml-plus-1 -s +order_totals
case_sel yml-selector-1 --selector ot_up
case_sel yml-exclude-1 --exclude hard
case_sel yml-plus-2 -s +order_totals
case_sel yml-selector-2 --selector ot_up
record rm-selectors /bin/rm selectors.yml
case_sel noyml-plus-3 -s +order_totals
