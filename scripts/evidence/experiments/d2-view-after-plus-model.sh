# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# D2: after a full strict compile, an edit to order_totals and `compile -s +order_totals`, does the
# `column_lineage` view still hold rows for the unselected models? "Populated" means: the view holds rows for every
# model it held after the full compile (hard, order_totals, stg_orders, totals_downstream), and the panel's
# downstream read of order_totals (buildLineageQuery, parent_node_unique_id in (…)) still returns the
# totals_downstream edge. Case A: parent never built (the on-save path). Case B: parent built by `dbt run` first.
# Decision rule, fixed before running: populated in both cases → refresh on save uses `-s +<model>` alone;
# otherwise it adds the models the view held before the compile to the selection. HOME is a fresh dir under the
# output root.
mkdir -p "$EVIDENCE_OUT/home"
with FUSION_POWER_USER_SCHEMA_ORIGIN=local HOME="$EVIDENCE_OUT/home"
# panel <label>: the panel's upstream and downstream reads for order_totals, as buildLineageQuery writes them.
panel() {
  local cols="select parent_node_unique_id, parent_column_name, child_node_unique_id, child_column_name, evolution"
  record "$1-up" dbtp show --inline "$cols
from {{ info_schema('column_lineage') }}
where child_node_unique_id in ('model.lineage_probe.order_totals')" --output json --limit -1 --quiet
  record "$1-down" dbtp show --inline "$cols
from {{ info_schema('column_lineage') }}
where parent_node_unique_id in ('model.lineage_probe.order_totals')" --output json --limit -1 --quiet
}
# case_view <label> [build]: fresh target, optional `dbt run`, full compile, edit, `-s +order_totals`.
case_view() {
  reset_target
  set_model order_totals "$ORDER_TOTALS_ORIG"
  if [[ "${2:-}" == build ]]; then record "$1-run" dbtp run; fi
  record "$1-full" dbtp compile --static-analysis strict --generate-info-schema
  lineage "$1-l0"
  panel "$1-p0"
  set_model order_totals "$ORDER_TOTALS_EDIT"
  record "$1-plus-model" dbtp compile -s +order_totals --static-analysis strict --generate-info-schema
  lineage "$1-l1"
  panel "$1-p1"
}
case_view a
case_view b build
