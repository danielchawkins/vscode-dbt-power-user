# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# S3c: with the parent built, does `compile -s order_totals` leave the lineage view holding every model or only the
# selection, depending on whether `dbt run -s stg_orders` ran BEFORE or AFTER the full compile? Also reads the
# column_lineage parquets under target/info_schema, target/private/metadata/compile and target/private/index directly.
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
cat > "$EVIDENCE_PROJECT/macros/drop_stg_orders.sql" << 'SQL'
{% macro drop_stg_orders() %}
  {% do run_query("drop view if exists main.stg_orders") %}
  {% do run_query("drop table if exists main.stg_orders") %}
{% endmacro %}
SQL
parquets() {
  local name f
  for name in info_schema/v1/dbt.column_lineage.parquet 'private/metadata/compile/column_lineage/*.parquet' \
    private/index/dbt.column_lineage.parquet; do
    f="$(basename "$(dirname "$name")")"
    record "$1-pq-$f" dbtp show --inline "select * from read_parquet('target/$name', filename = true)" \
      --output json --limit -1 --quiet
  done
}
sel() { record "$1" dbtp compile "${@:2}" --static-analysis strict --generate-info-schema; }

# A: run after full compile.
sel a-full
record a-run-parent dbtp run -s stg_orders
set_model order_totals "$ORDER_TOTALS_EDIT"
sel a-ot -s order_totals
lineage a-l1
parquets a-l1

# B: run before full compile.
reset_target
record b-drop-parent dbtp run-operation drop_stg_orders
set_model order_totals "$ORDER_TOTALS_ORIG"
record b-run-parent dbtp run -s stg_orders
sel b-full
set_model order_totals "$ORDER_TOTALS_EDIT"
sel b-ot -s order_totals
lineage b-l1
parquets b-l1
