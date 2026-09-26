# shellcheck shell=bash
# Helpers for experiments, sourced by run.sh after it defines record, lsp, dbtp, with and snapshot.

# reset_target: delete target/ and logs/ so the next step starts from nothing (the warehouse is kept).
reset_target() { rm -rf "$EVIDENCE_PROJECT/target" "$EVIDENCE_PROJECT/logs"; }

# save_target <label>: copy target/ as it is now into the output dir, for later diffing.
save_target() {
  if [[ -d "$EVIDENCE_PROJECT/target" ]]; then
    mkdir -p "$EVIDENCE_OUT/targets"
    cp -R "$EVIDENCE_PROJECT/target" "$EVIDENCE_OUT/targets/$1"
  fi
}

# set_model <name> <sql>: overwrite models/<name>.sql.
set_model() { printf '%s\n' "$2" > "$EVIDENCE_PROJECT/models/$1.sql"; }

# lineage <label>: record `dbt show --info column_lineage` as JSON (the canonical read for every experiment).
lineage() { record "$1" dbtp show --info column_lineage --output json --limit -1 --quiet; }

# The edit used across experiments: order_totals gains `biggest`. Read by experiments (sourced later).
# shellcheck disable=SC2034
ORDER_TOTALS_ORIG="select customer_id, sum(amount) as total, count(*) as n, max(status) as last_status
from {{ ref('stg_orders') }}
group by customer_id"
# shellcheck disable=SC2034
ORDER_TOTALS_EDIT="select customer_id, sum(amount) as total, count(*) as n, max(status) as last_status, max(amount) as biggest
from {{ ref('stg_orders') }}
group by customer_id"
