# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, dbtp, with and EVIDENCE_*.
# C1: which of --static-analysis and --generate-info-schema (flag or env) must be set on `dbt compile` for the
# column_lineage parquet to be written? Each variant starts from an empty target/ and changes one piece of the
# baseline `compile --static-analysis strict --generate-info-schema`. The last variant asks whether a compile
# without --generate-info-schema refreshes (or removes) lineage an earlier compile wrote.
with FUSION_POWER_USER_SCHEMA_ORIGIN=local

reset_target
record a-baseline dbtp compile --static-analysis strict --generate-info-schema
lineage a-lineage

reset_target
record b-strict-no-gis dbtp compile --static-analysis strict
lineage b-lineage

reset_target
record c-sa-baseline-gis dbtp compile --static-analysis baseline --generate-info-schema
lineage c-lineage

reset_target
record d-sa-off-gis dbtp compile --static-analysis off --generate-info-schema
lineage d-lineage

reset_target
record e-no-sa-flag-gis dbtp compile --generate-info-schema
lineage e-lineage

# Refresh: baseline, edit order_totals, recompile without --generate-info-schema.
reset_target
record j-baseline dbtp compile --static-analysis strict --generate-info-schema
set_model order_totals "$ORDER_TOTALS_EDIT"
record j-edit-strict-no-gis dbtp compile --static-analysis strict
lineage j-lineage-after-no-gis
record j-edit-strict-gis dbtp compile --static-analysis strict --generate-info-schema
lineage j-lineage-after-gis
set_model order_totals "$ORDER_TOTALS_ORIG"
