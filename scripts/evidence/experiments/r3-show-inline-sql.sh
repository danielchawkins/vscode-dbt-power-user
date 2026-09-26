# shellcheck shell=bash
# R3: which SQL features work in `dbt show --inline` over {{ info_schema('column_lineage') }} and the other views,
# and what are the exact errors for those that do not?
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
record compile dbtp compile --static-analysis strict --generate-info-schema
cl="{{ info_schema('column_lineage') }}"
nc="{{ info_schema('node_columns') }}"
q() { record "$1" dbtp show --inline "$2" --output json --limit -1 --quiet; }
q where-child "select * from $cl where child_node_unique_id = 'model.lineage_probe.order_totals'"
q where-parent "select * from $cl where parent_node_unique_id = 'source.lineage_probe.raw.orders'"
q where-child-col "select parent_node_unique_id, parent_column_name, evolution from $cl
where child_node_unique_id = 'model.lineage_probe.totals_downstream' and child_column_name = 'grand_total'"
q in-list "select * from $cl where child_node_unique_id in ('model.lineage_probe.order_totals', 'model.lineage_probe.totals_downstream')"
q tuple-in "select * from $cl where (child_node_unique_id, child_column_name) in (('model.lineage_probe.order_totals', 'total'))"
q group-count "select child_node_unique_id, evolution, count(*) as n from $cl group by 1, 2 order by 1, 2"
q distinct-cols "select distinct child_node_unique_id, child_column_name from $cl order by 1, 2"
q node-columns-keys "select * from $nc limit 3"
q join-node-columns "select cl.child_node_unique_id, cl.child_column_name, cl.parent_node_unique_id, cl.parent_column_name,
  cl.evolution, pc.data_type as parent_data_type, cc.data_type as child_data_type
from $cl cl
left join $nc pc on pc.node_unique_id = cl.parent_node_unique_id and pc.column_name = cl.parent_column_name
left join $nc cc on cc.node_unique_id = cl.child_node_unique_id and cc.column_name = cl.child_column_name
order by 1, 2, 3, 4"
q join-node-columns-inferred "select cl.child_node_unique_id, cl.child_column_name, cl.parent_node_unique_id, cl.parent_column_name,
  cl.evolution, pc.data_type_declared as parent_declared, pc.data_type_inferred as parent_inferred,
  cc.data_type_inferred as child_inferred
from $cl cl
left join $nc pc on pc.node_unique_id = cl.parent_node_unique_id and pc.column_name = cl.parent_column_name
left join $nc cc on cc.node_unique_id = cl.child_node_unique_id and cc.column_name = cl.child_column_name
where cl.child_node_unique_id = 'model.lineage_probe.order_totals'
order by 1, 2, 3, 4"
q columns-without-lineage "select nc.node_unique_id, nc.column_name from $nc nc
where nc.node_unique_id like 'model.%' and not exists (select 1 from $cl cl
  where cl.child_node_unique_id = nc.node_unique_id and cl.child_column_name = nc.column_name)
order by 1, 2"
q join-models "select cl.child_node_unique_id, m.* from $cl cl join {{ info_schema('models') }} m
on m.unique_id = cl.child_node_unique_id limit 2"
q join-schema-qualified "select count(*) as n from dbt.column_lineage cl join dbt.node_columns nc
on nc.node_unique_id = cl.child_node_unique_id"
q recursive-upstream "with recursive up(node_id, col, depth) as (
  select 'model.lineage_probe.totals_downstream', 'grand_total', 0
  union
  select cl.parent_node_unique_id, cl.parent_column_name, up.depth + 1
  from up join $cl cl on cl.child_node_unique_id = up.node_id and cl.child_column_name = up.col
  where up.depth < 10
)
select * from up order by depth, node_id, col"
q recursive-upstream-kind "with recursive up(node_id, col, depth, kinds) as (
  select 'model.lineage_probe.totals_downstream', 'grand_total', 0, ''
  union all
  select cl.parent_node_unique_id, cl.parent_column_name, up.depth + 1, up.kinds || cl.evolution || '/'
  from up join $cl cl on cl.child_node_unique_id = up.node_id and cl.child_column_name = up.col
  where up.depth < 10
)
select * from up order by depth, node_id, col"
q recursive-downstream "with recursive dn(node_id, col, depth) as (
  select 'source.lineage_probe.raw.orders', 'amount', 0
  union
  select cl.child_node_unique_id, cl.child_column_name, dn.depth + 1
  from dn join $cl cl on cl.parent_node_unique_id = dn.node_id and cl.parent_column_name = dn.col
  where dn.depth < 10
)
select * from dn order by depth, node_id, col"
q using-key-recursive "with recursive up(node_id, col) using key (node_id, col) as (
  select 'model.lineage_probe.totals_downstream', 'grand_total'
  union
  select cl.parent_node_unique_id, cl.parent_column_name
  from up join $cl cl on cl.child_node_unique_id = up.node_id and cl.child_column_name = up.col
)
select * from up order by 1, 2"
q window-fn "select child_node_unique_id, child_column_name, parent_column_name,
  row_number() over (partition by child_node_unique_id, child_column_name order by parent_column_name) as rn
from $cl where child_node_unique_id = 'model.lineage_probe.order_totals' order by 1, 2, 4"
q json-agg "select child_node_unique_id, child_column_name,
  list(struct_pack(p := parent_node_unique_id, c := parent_column_name, e := evolution)) as parents
from $cl group by 1, 2 order by 1, 2"
q string-agg "select child_node_unique_id, child_column_name, string_agg(parent_column_name, ',' order by parent_column_name) as ps
from $cl group by 1, 2 order by 1, 2"
q lower-ilike "select * from $cl where child_node_unique_id ilike '%ORDER_TOTALS'"
q qualify "select * from $cl qualify row_number() over (partition by child_node_unique_id order by child_column_name) = 1"
q bad-column "select not_a_column from $cl"
q bad-syntax "select from where $cl"
q no-info-schema-call "select 1 as x"
q read-parquet "select count(*) as n from read_parquet('target/info_schema/v1/dbt.column_lineage.parquet')"
q jinja-var "{% set m = 'model.lineage_probe.order_totals' %}select * from $cl where child_node_unique_id = '{{ m }}'"
q two-statements "select 1 from $cl; select 2 from $cl"
record inline-limit-default dbtp show --inline "select * from $cl" --output json --quiet
record inline-where-table dbtp show --inline "select * from $cl where child_node_unique_id = 'model.lineage_probe.order_totals'" --output table --quiet
