# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# E5: CLI path. Full compile, then per-model recompile after an edit, then read lineage via dbt show.
# Questions: does `-s <model>` refresh that model's lineage? What does dbt show emit on stdout with --quiet?
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
record cli-compile-full dbtp compile --static-analysis strict --generate-info-schema \
  --log-level-file trace --otel-file-name cli-full-otel.jsonl
record show-info-json dbtp show --info column_lineage --output json --limit -1 --quiet
record show-info-ndjson dbtp show --info column_lineage --output ndjson --limit -1 --quiet
record show-info-inline-where dbtp show --inline \
  "select * from {{ info_schema('column_lineage') }} where child_node_unique_id = 'model.lineage_probe.order_totals'" \
  --output json --limit -1 --quiet
cat > "$EVIDENCE_PROJECT/models/order_totals.sql" << 'SQL'
select customer_id, sum(amount) as total, count(*) as n, max(status) as last_status, max(amount) as biggest
from {{ ref('stg_orders') }}
group by customer_id
SQL
record cli-compile-one dbtp compile -s order_totals --static-analysis strict --generate-info-schema \
  --log-level-file trace --otel-file-name cli-one-otel.jsonl
record show-info-after-one dbtp show --info column_lineage --output json --limit -1 --quiet
with FUSION_POWER_USER_SCHEMA_ORIGIN=remote
record cli-compile-one-remote-parent \
  dbtp compile -s order_totals --static-analysis strict --generate-info-schema
