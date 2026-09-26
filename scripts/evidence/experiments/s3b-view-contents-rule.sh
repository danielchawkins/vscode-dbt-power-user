# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# S3b: which rows does the lineage view hold after a selective compile, depending on (a) whether a failed dbt1014
# compile preceded it (e6 order vs s2 order) and (b) whether any project file changed since the previous compile?
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
cat > "$EVIDENCE_PROJECT/macros/drop_stg_orders.sql" << 'SQL'
{% macro drop_stg_orders() %}
  {% do run_query("drop view if exists main.stg_orders") %}
  {% do run_query("drop table if exists main.stg_orders") %}
{% endmacro %}
SQL
# parquets <label>: read the view's parquet and the private compile lineage parquets directly.
parquets() {
  record "$1-pq-info" dbtp show --inline \
    "select * from read_parquet('target/info_schema/v1/dbt.column_lineage.parquet', filename = true)" \
    --output json --limit -1 --quiet
  record "$1-pq-private" dbtp show --inline \
    "select * from read_parquet('target/private/metadata/compile/column_lineage/*.parquet', filename = true)" \
    --output json --limit -1 --quiet
}
sel() { record "$1" dbtp compile "${@:2}" --static-analysis strict --generate-info-schema; }

# A: e6 order. full → edit → -s order_totals (dbt1014) → run stg_orders → -s order_totals.
sel a-full
lineage a-l0
set_model order_totals "$ORDER_TOTALS_EDIT"
sel a-ot-fail -s order_totals
lineage a-l1
record a-run-parent dbtp run -s stg_orders
sel a-ot-ok -s order_totals
lineage a-l2
parquets a-l2

# A2: same as A without the failing compile. full → edit → run stg_orders → -s order_totals.
reset_target
record a2-drop-parent dbtp run-operation drop_stg_orders
set_model order_totals "$ORDER_TOTALS_ORIG"
sel a2-full
set_model order_totals "$ORDER_TOTALS_EDIT"
record a2-run-parent dbtp run -s stg_orders
sel a2-ot-ok -s order_totals
lineage a2-l1

# B: no-change recompile. full → edit → -s +order_totals → -s +hard (no file changed) → edit hard → -s +hard.
reset_target
record b-drop-parent dbtp run-operation drop_stg_orders
set_model order_totals "$ORDER_TOTALS_ORIG"
sel b-full
set_model order_totals "$ORDER_TOTALS_EDIT"
sel b-plus-ot -s +order_totals
lineage b-l1
sel b-plus-hard-unchanged -s +hard
lineage b-l2
printf '%s\n' '-- touched' >> "$EVIDENCE_PROJECT/models/hard.sql"
sel b-plus-hard-changed -s +hard
lineage b-l3
parquets b-l3
sel b-full-unchanged
lineage b-l4
printf '%s\n' '-- touched again' >> "$EVIDENCE_PROJECT/models/hard.sql"
sel b-full-changed
lineage b-l5
