# shellcheck shell=bash
# R6: does `dbt show --info` / `--inline` over info_schema() touch the warehouse (DuckDB file, query log)?
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
record compile dbtp compile --static-analysis strict --generate-info-schema
record ls-after-compile /bin/ls -la . logs
record query-log-after-compile /bin/cat logs/query_log.sql
record db-sha-before /usr/bin/shasum -a 256 probe.duckdb
record show-info dbtp show --info column_lineage --output json --limit -1 --quiet
record query-log-after-show /bin/cat logs/query_log.sql
record dbt-log-after-show /usr/bin/tail -n 60 logs/dbt.log
record db-sha-after-show /usr/bin/shasum -a 256 probe.duckdb
record hide-db /bin/mv probe.duckdb probe.duckdb.hidden
record show-info-db-hidden dbtp show --info column_lineage --output json --limit -1 --quiet
record ls-after-show-info-db-hidden /bin/ls -la .
record inline-db-hidden dbtp show --inline \
  "select * from {{ info_schema('column_lineage') }} where child_node_unique_id = 'model.lineage_probe.order_totals'" \
  --output json --limit -1 --quiet
record ls-after-inline-db-hidden /bin/ls -la .
record inline-plain-db-hidden dbtp show --inline "select 1 as x" --output json --limit -1 --quiet
record ls-db-hidden /bin/ls -la .
record query-log-db-hidden /bin/cat logs/query_log.sql
record unhide-db /bin/mv probe.duckdb.hidden probe.duckdb
record db-sha-end /usr/bin/shasum -a 256 probe.duckdb
record warehouse-show-model dbtp show -s stg_orders --output json --limit 2 --quiet
record query-log-after-warehouse-show /bin/cat logs/query_log.sql
