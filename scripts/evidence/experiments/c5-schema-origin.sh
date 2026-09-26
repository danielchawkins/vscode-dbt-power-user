# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, dbtp, with, without and EVIDENCE_*.
# C5: how does FUSION_POWER_USER_SCHEMA_ORIGIN (read by the fixture's dbt_project.yml as sources.+schema_origin)
# affect `compile --static-analysis strict --generate-info-schema`? Unset, remote, local, an invalid value, then
# remote and local with the raw.contacts source table dropped from the warehouse.
base=(--static-analysis strict --generate-info-schema)

reset_target
without
record a-unset dbtp compile "${base[@]}"
lineage a-lineage

reset_target
with FUSION_POWER_USER_SCHEMA_ORIGIN=remote
record b-remote dbtp compile "${base[@]}"
lineage b-lineage

reset_target
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
record c-local dbtp compile "${base[@]}"
lineage c-lineage

reset_target
with FUSION_POWER_USER_SCHEMA_ORIGIN=bogus
record d-invalid dbtp compile "${base[@]}"
lineage d-lineage

with FUSION_POWER_USER_SCHEMA_ORIGIN=local
record e-drop-contacts dbtp run-operation drop_contacts

reset_target
with FUSION_POWER_USER_SCHEMA_ORIGIN=remote
record f-remote-dropped dbtp compile "${base[@]}"
lineage f-lineage

reset_target
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
record g-local-dropped dbtp compile "${base[@]}"
lineage g-lineage

record h-restore dbtp run-operation setup_raw
