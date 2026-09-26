# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# E6: per-model refresh semantics. After a full strict compile, edit order_totals and recompile with different
# selectors. Record the full column_lineage table after each, to see what a selective compile keeps and replaces.
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
record cli-compile-full dbtp compile --static-analysis strict --generate-info-schema
record show-after-full dbtp show --info column_lineage --output json --limit -1 --quiet
cat > "$EVIDENCE_PROJECT/models/order_totals.sql" << 'SQL'
select customer_id, sum(amount) as total, count(*) as n, max(status) as last_status, max(amount) as biggest
from {{ ref('stg_orders') }}
group by customer_id
SQL
record compile-plus-model dbtp compile -s +order_totals --static-analysis strict --generate-info-schema
record show-after-plus-model dbtp show --info column_lineage --output json --limit -1 --quiet
record compile-model-only dbtp compile -s order_totals --static-analysis strict --generate-info-schema
record show-after-model-only dbtp show --info column_lineage --output json --limit -1 --quiet
record run-parent dbtp run -s stg_orders
record compile-model-only-parent-built dbtp compile -s order_totals --static-analysis strict --generate-info-schema
record show-after-model-only-parent-built dbtp show --info column_lineage --output json --limit -1 --quiet
record compile-full-again dbtp compile --static-analysis strict --generate-info-schema
record show-after-full-again dbtp show --info column_lineage --output json --limit -1 --quiet
