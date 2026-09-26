# shellcheck shell=bash
# R5: how long does one `dbt show --info column_lineage` (and an --inline WHERE) take, wall clock, when repeated?
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
record compile dbtp compile --static-analysis strict --generate-info-schema
for i in 1 2 3 4 5; do
  record "info-json-$i" dbtp show --info column_lineage --output json --limit -1 --quiet
done
for i in 1 2 3 4 5; do
  record "inline-where-$i" dbtp show --inline \
    "select * from {{ info_schema('column_lineage') }} where child_node_unique_id = 'model.lineage_probe.order_totals'" \
    --output json --limit -1 --quiet
done
for i in 1 2 3; do
  record "inline-recursive-$i" dbtp show --inline "with recursive up(node_id, col) as (
  select 'model.lineage_probe.totals_downstream', 'grand_total'
  union
  select cl.parent_node_unique_id, cl.parent_column_name
  from up join {{ info_schema('column_lineage') }} cl on cl.child_node_unique_id = up.node_id and cl.child_column_name = up.col
)
select * from up" --output json --limit -1 --quiet
done
for i in 1 2 3; do
  record "version-$i" "$DBT_BIN" --version
done
# Harness floor: started/ended are sampled by separate node processes around the command.
for i in 1 2 3; do
  record "baseline-true-$i" /usr/bin/true
done
