# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# S3: is the lineage view the union of past compiles or only the last compile's selection? Compare
# full → -s +order_totals → lineage with full → -s +order_totals → -s +hard → lineage, and track which files under
# target/info_schema, target/private/index and target/private/metadata/compile/column_lineage change per step.
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
# parquets <label>: read each column_lineage parquet file under target/ directly (duckdb read_parquet via dbt show).
parquets() {
  local f
  for f in info_schema/v1/dbt.column_lineage.parquet private/index/dbt.column_lineage.parquet \
    'private/metadata/compile/column_lineage/*.parquet'; do
    if compgen -G "$EVIDENCE_PROJECT/target/$f" > /dev/null; then
      record "$1-pq-$(basename "$(dirname "$f")")" dbtp show --inline \
        "select * from read_parquet('target/$f', filename = true)" --output json --limit -1 --quiet
    fi
  done
}
record a-full dbtp compile --static-analysis strict --generate-info-schema
lineage a-l0
set_model order_totals "$ORDER_TOTALS_EDIT"
record a-compile-plus-ot dbtp compile -s +order_totals --static-analysis strict --generate-info-schema
lineage a-l1
parquets a-l1
save_target a-end

reset_target
set_model order_totals "$ORDER_TOTALS_ORIG"
record b-full dbtp compile --static-analysis strict --generate-info-schema
lineage b-l0
set_model order_totals "$ORDER_TOTALS_EDIT"
record b-compile-plus-ot dbtp compile -s +order_totals --static-analysis strict --generate-info-schema
lineage b-l1
record b-compile-plus-hard dbtp compile -s +hard --static-analysis strict --generate-info-schema
lineage b-l2
parquets b-l2
# A compile without --generate-info-schema: does the view still reflect the previous info-schema write?
record b-compile-full-no-infoschema dbtp compile --static-analysis strict
lineage b-l3
record b-compile-full dbtp compile --static-analysis strict --generate-info-schema
lineage b-l4
save_target b-end
