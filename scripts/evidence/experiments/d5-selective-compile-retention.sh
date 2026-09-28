# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# D5: does a selective strict compile keep the other models' column lineage in the `column_lineage` view, and
# which argv makes successive saves accumulate? Each case: fresh target, full strict compile, edit order_totals
# (adds `biggest`) and refresh it, then edit hard (adds `amt2`) and refresh it. "Kept" means the view after the
# second refresh holds all five models, order_totals with `biggest` and hard with `amt2`. totals_star is a
# `select *` child of order_totals. Each refresh is followed by the view and by a latest-wins read of Fusion's
# private epoch store (target/private/metadata/compile/column_lineage/v1_*.parquet), so the store and its
# projection can be compared.
# Decision rule, fixed before running: the refresh on save uses the first case that is kept, in this order of
# preference: plain `-s +<model>`, `--partial-parse`, `--dirty --partial-parse`, `-s +<model> --exclude <x>`. If
# none is kept, the extension reads the private store with latest-wins. `select *` children: if the kept argv with
# `+<model>+` gives totals_star `biggest`, the refresh selects `+<model>+`.
mkdir -p "$EVIDENCE_OUT/home"
with FUSION_POWER_USER_SCHEMA_ORIGIN=local HOME="$EVIDENCE_OUT/home"
printf '%s\n' "select * from {{ ref('order_totals') }}" > "$EVIDENCE_PROJECT/models/totals_star.sql"
HARD_ORIG="$(cat "$EVIDENCE_PROJECT/models/hard.sql")"
HARD_EDIT="${HARD_ORIG/select id, name as label, amt, rn from j/select id, name as label, amt, rn, amt as amt2 from j}"
HARD_EDIT="${HARD_EDIT/select user_id, contact, 0, 0 from/select user_id, contact, 0, 0, 0 from}"
store() {
  record "$1" dbtp show --inline "with r as (select * from read_parquet(
  'target/private/metadata/compile/column_lineage/v1_*.parquet')),
w as (select to_node_unique_id, max(ingested_at) as m from r group by 1)
select r.* from r join w on r.to_node_unique_id = w.to_node_unique_id and r.ingested_at = w.m" \
    --output json --limit -1 --quiet
}
strict() { record "$1" dbtp compile "${@:2}" --static-analysis strict --generate-info-schema; }
# refresh_case <label> <full-extra|-> <argv with MODEL...>
refresh_case() {
  local label="$1" full_extra="$2"
  shift 2
  reset_target
  set_model order_totals "$ORDER_TOTALS_ORIG"
  set_model hard "$HARD_ORIG"
  if [[ "$full_extra" == - ]]; then strict "$label-full"; else strict "$label-full" "$full_extra"; fi
  lineage "$label-l0"
  set_model order_totals "$ORDER_TOTALS_EDIT"
  strict "$label-r1" "${@//MODEL/order_totals}"
  lineage "$label-l1"
  store "$label-s1"
  set_model hard "$HARD_EDIT"
  strict "$label-r2" "${@//MODEL/hard}"
  lineage "$label-l2"
  store "$label-s2"
}
record 01-setup-warehouse dbtp run-operation setup_raw
refresh_case a-plus - -s +MODEL
refresh_case b-partial --partial-parse --partial-parse -s +MODEL
refresh_case c-dirty --partial-parse --dirty --partial-parse
refresh_case d-exclude-absent - -s +MODEL --exclude no_such_node
refresh_case e-exclude-present - -s +MODEL --exclude totals_downstream
refresh_case f-exclude-selected - -s +MODEL --exclude stg_orders
refresh_case g-exclude-children - -s +MODEL+ --exclude no_such_node
record 90-run-parents dbtp run
refresh_case h-built-bare - -s MODEL
refresh_case i-built-bare-exclude - -s MODEL --exclude no_such_node
