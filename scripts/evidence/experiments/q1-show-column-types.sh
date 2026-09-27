# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, dbtp and EVIDENCE_*.
# Q1: where can query-result column types come from? `dbt show` output formats, `dbt.show` over the LSP is covered
# by p3-commands. Records each `dbt show --output` format for one typed inline query, and the info-schema node
# columns a strict compile writes for the same shape as a model.
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
query="select 1::integer as i, 1.5::double as f, 'x' as s, true as b, date '2026-01-01' as d"
for format in json ndjson yml csv table; do
  record "show-inline-$format" dbtp show --inline "$query" --output "$format" --limit 5 --quiet
done
record compile-strict dbtp compile --static-analysis strict --generate-info-schema
record node-columns-order-totals dbtp show --output json --limit -1 --quiet \
  --inline "select node_unique_id, column_name, data_type_declared, data_type_inferred, data_type_actual
    from {{ info_schema('node_columns') }} where node_unique_id = 'model.lineage_probe.order_totals'"
