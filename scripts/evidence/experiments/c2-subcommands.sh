# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, dbtp, with and EVIDENCE_*.
# C2: which subcommands (parse, compile, build, run, list) write column_lineage when given --generate-info-schema?
# parse and list have no --static-analysis flag; the documented env var for them would be DBT_ENGINE_STATIC_ANALYSIS (see m1).
# `parse --write-metadata` is not in parse --help; it is recorded once to show how the binary reacts.
with FUSION_POWER_USER_SCHEMA_ORIGIN=local

reset_target
record a-parse-gis dbtp parse --generate-info-schema
lineage a-lineage

reset_target
record c-compile-strict-gis dbtp compile --static-analysis strict --generate-info-schema
lineage c-lineage

reset_target
record d-build-strict-gis dbtp build --static-analysis strict --generate-info-schema
lineage d-lineage

reset_target
record e-run-strict-gis dbtp run --static-analysis strict --generate-info-schema
lineage e-lineage

reset_target
record f-list-gis dbtp list --generate-info-schema
lineage f-lineage

reset_target
record h-parse-write-metadata dbtp parse --write-metadata
lineage h-lineage

# parse and list with the documented env var name for static analysis.
reset_target
with FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_ENGINE_STATIC_ANALYSIS=strict
record h-parse-gis-engine-strict dbtp parse --generate-info-schema
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
lineage h-lineage

reset_target
with FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_ENGINE_STATIC_ANALYSIS=strict
record i-list-gis-engine-strict dbtp list --generate-info-schema
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
lineage i-lineage
