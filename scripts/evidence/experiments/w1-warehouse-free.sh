# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh.
# W1: with sources.+schema_origin local and every source column typed, which strict compiles need the warehouse?
# Signal: Fusion's logs/query_log.sql, copied after each step as query_log.sql; a DESCRIBE there means a schema
# download. dbt1014 in stdout means Fusion set static_analysis off for the model.
# Source (open crates, 9977b6c): crates/dbt-tasks-core/src/local_schema_builder.rs:140-150 builds local schemas
# only for sources with local origin; crates/dbt-schemas/src/schemas/nodes.rs:666 defaults every node to Remote.
base=(--static-analysis strict --generate-info-schema)
# shellcheck disable=SC2154 # step comes from run.sh
qlog() { cp "$EVIDENCE_PROJECT/logs/query_log.sql" "$EVIDENCE_OUT/steps/$(printf '%02d' "$step")-$1/query_log.sql" \
  2> /dev/null || : > "$EVIDENCE_OUT/steps/$(printf '%02d' "$step")-$1/query_log.sql"; }
step_q() {
  local label="$1"
  shift
  rm -f "$EVIDENCE_PROJECT/logs/query_log.sql"
  record "$label" "$@"
  qlog "$label"
}
typed_models='version: 2
models:
  - name: stg_orders
    config:
      contract: {enforced: true}
    columns:
      - { name: id, data_type: integer }
      - { name: customer_id, data_type: integer }
      - { name: amount, data_type: "decimal(10,2)" }
      - { name: status, data_type: varchar }
      - { name: note, data_type: varchar }
  - name: order_totals
    columns:
      - { name: customer_id, data_type: integer }
      - { name: total, data_type: "decimal(38,2)" }
      - { name: n, data_type: bigint }
      - { name: last_status, data_type: varchar }'
cp "$EVIDENCE_PROJECT/dbt_project.yml" "$EVIDENCE_OUT/dbt_project.yml.orig"

with FUSION_POWER_USER_SCHEMA_ORIGIN=local
reset_target
step_q full-local dbtp compile "${base[@]}"
reset_target
step_q select-bare-local dbtp compile -s order_totals "${base[@]}"
reset_target
step_q select-plus-local dbtp compile -s +order_totals "${base[@]}"

printf '%s\n' "$typed_models" > "$EVIDENCE_PROJECT/models/typed_models.yml"
reset_target
step_q select-bare-typed-contract dbtp compile -s order_totals "${base[@]}"

printf '%s\n' 'models:' '  +schema_origin: local' >> "$EVIDENCE_PROJECT/dbt_project.yml"
reset_target
step_q models-schema-origin dbtp compile -s order_totals "${base[@]}"
cp "$EVIDENCE_OUT/dbt_project.yml.orig" "$EVIDENCE_PROJECT/dbt_project.yml"
rm "$EVIDENCE_PROJECT/models/typed_models.yml"

mv "$EVIDENCE_PROJECT/probe.duckdb" "$EVIDENCE_OUT/probe.duckdb.moved"
reset_target
step_q full-local-no-warehouse dbtp compile "${base[@]}"
lineage full-local-no-warehouse-lineage
reset_target
step_q select-plus-local-no-warehouse dbtp compile -s +order_totals "${base[@]}"
# Shows whether any step recreated the DuckDB file while it was moved away.
record no-warehouse-ls /bin/ls -la
mv "$EVIDENCE_OUT/probe.duckdb.moved" "$EVIDENCE_PROJECT/probe.duckdb"

with FUSION_POWER_USER_SCHEMA_ORIGIN=remote
reset_target
step_q full-remote dbtp compile "${base[@]}"
