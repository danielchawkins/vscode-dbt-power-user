# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh.
# R9: is `show --inline <lineage query> --output json --limit -1 --quiet` one JSON array line with empty stderr?
# The query is the one the extension builds for the lineage panel (src/fusion/columnLineage.ts buildLineageQuery).
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
q_up="select parent_node_unique_id, parent_column_name, child_node_unique_id, child_column_name, evolution
from {{ info_schema('column_lineage') }}
where child_node_unique_id in ('model.lineage_probe.order_totals')"
q_down="select parent_node_unique_id, parent_column_name, child_node_unique_id, child_column_name, evolution
from {{ info_schema('column_lineage') }}
where parent_node_unique_id in ('model.lineage_probe.order_totals')"
q_none="select parent_node_unique_id, parent_column_name, child_node_unique_id, child_column_name, evolution
from {{ info_schema('column_lineage') }}
where child_node_unique_id in ('model.lineage_probe.no_such_model')"
show() { record "$1" dbtp show --inline "$2" --output json --limit -1 --quiet; }

reset_target
show before-compile "$q_up"
record compile dbtp compile --static-analysis strict --generate-info-schema
show upstream "$q_up"
show downstream "$q_down"
show no-rows "$q_none"
