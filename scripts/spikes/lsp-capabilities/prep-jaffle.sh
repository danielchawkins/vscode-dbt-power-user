#!/bin/sh
# Copies the jaffle-shop DuckDB fixture to $1 (default /tmp/lsp-jaffle), adds a macro, a dotted macro call, a source,
# an exposure and a singular test, then seeds and builds it so `dbt show` has relations to read.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
dest=${1:-/tmp/lsp-jaffle}
dbt=${DBT_BIN:-/Users/daniel/.local/share/mise/installs/aqua-getdbt-com-dbt-fusion/2.0.6/dbt}
rm -rf "$dest"
cp -R "$repo/test-fixtures/jaffle-shop-duckdb" "$dest"
cd "$dest"
rm -rf target logs jaffle_shop.duckdb
mkdir -p macros tests
cat > macros/cents_to_dollars.sql << 'EOF'
{% macro cents_to_dollars(column_name, scale=2) %}
    ({{ column_name }} / 100)::numeric(16, {{ scale }})
{% endmacro %}
EOF
cat > models/payments_dollars.sql << 'EOF'
select
    payment_id,
    {{ cents_to_dollars('amount') }} as amount_dollars,
    {{ jaffle_shop.cents_to_dollars('amount', 4) }} as amount_dollars_precise
from {{ ref('stg_payments') }}
EOF
cat > models/src_orders.sql << 'EOF'
select id, user_id, status from {{ source('raw', 'raw_orders') }}
EOF
cat > models/sources.yml << 'EOF'
version: 2
sources:
  - name: raw
    schema: main
    tables:
      - name: raw_orders
        description: Seeded orders, read as a source
exposures:
  - name: weekly_report
    type: dashboard
    owner: { name: Analytics, email: analytics@example.com }
    depends_on:
      - ref('customers')
      - ref('orders')
EOF
cat > tests/assert_positive_amount.sql << 'EOF'
select * from {{ ref('orders') }} where amount < 0
EOF
"$dbt" build --profiles-dir . --static-analysis strict --quiet > build.log 2>&1 || {
  tail -20 build.log
  exit 1
}
echo "prepared $dest"
