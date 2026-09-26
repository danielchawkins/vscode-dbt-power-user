# shellcheck shell=bash
# R4: which info-schema views does `dbt show --info` name, and after one strict compile which have rows and what keys?
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
record compile dbtp compile --static-analysis strict --generate-info-schema
record nonexistent-view dbtp show --info nonexistent_view --output json --limit -1 --quiet
# The list below is the "Available views" list from the step above, verbatim and in order.
for v in project packages project_vars project_env_vars models seeds snapshots functions analyses hooks checks \
  sources data_tests unit_tests macros groups exposures metrics docs_blocks saved_queries semantic_models \
  semantic_entities semantic_measures semantic_dimensions semantic_relationships time_spines dag_nodes edges \
  node_columns column_lineage classifiers invocations run_results freshness relations diagnostics adapter_queries; do
  record "view-$v" dbtp show --info "$v" --output json --limit -1 --quiet
  # json of an empty view has no keys; the table header still names the columns.
  record "header-$v" dbtp show --info "$v" --output table --limit 0 --quiet
done
# Views defined in views.sql but not in the list: are they reachable through info_schema()?
record inline-run-results-latest dbtp show --inline "select count(*) as n from {{ info_schema('run_results_latest') }}" \
  --output json --limit -1 --quiet
record inline-resources dbtp show --inline "select count(*) as n from {{ info_schema('resources') }}" \
  --output json --limit -1 --quiet
record inline-node-input-files dbtp show --inline "select * from {{ info_schema('node_input_files') }}" \
  --output json --limit -1 --quiet
