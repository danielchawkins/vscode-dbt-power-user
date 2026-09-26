# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# S3d: with every model built, does the lineage view after a selective compile of order_totals hold all models or
# only the selection, depending on (a) what ran between the edit and the compile (nothing, `run -s stg_orders`,
# `parse`, `list`), (b) the selection arguments, and (c) a repeat of the same compile?
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
sel() { record "$1" dbtp compile "${@:2}" --static-analysis strict --generate-info-schema; }
# case_mid <label> <between-step: none|run-parent|parse|list> <selection args...>
case_mid() {
  local label="$1" mid="$2"
  shift 2
  reset_target
  set_model order_totals "$ORDER_TOTALS_ORIG"
  record "$label-run-all" dbtp run
  sel "$label-full"
  set_model order_totals "$ORDER_TOTALS_EDIT"
  case "$mid" in
    run-parent) record "$label-mid" dbtp run -s stg_orders ;;
    parse) record "$label-mid" dbtp parse ;;
    list) record "$label-mid" dbtp list -s order_totals ;;
  esac
  sel "$label-ot" "$@"
  lineage "$label-l1"
  sel "$label-ot-again" "$@"
  lineage "$label-l2"
}
case_mid a-nothing none -s order_totals
case_mid b-run-parent run-parent -s order_totals
case_mid c-parse parse -s order_totals
case_mid d-list list -s order_totals
case_mid e-exclude none -s order_totals --exclude hard
case_mid f-two-models none -s order_totals hard
