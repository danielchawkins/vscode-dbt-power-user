# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh.
# F1: the compile output the extension's refresh classifies (src/fusion/lineageDiagnostics.ts). One step per
# outcome: analysed, dbt1014 fall-back (remote origin, dropped source), dbt1000 (info schema without strict),
# and a SQL error under strict.
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
reset_target
record analyzed dbtp compile -s +order_totals --static-analysis strict --generate-info-schema

reset_target
record no-strict dbtp compile -s +order_totals --static-analysis baseline --generate-info-schema

set_model probe_strict "select no_such_column from {{ ref('stg_orders') }}"
reset_target
record strict-sql-error dbtp compile -s +probe_strict --static-analysis strict --generate-info-schema
rm "$EVIDENCE_PROJECT/models/probe_strict.sql"

record drop-contacts dbtp run-operation drop_contacts
with FUSION_POWER_USER_SCHEMA_ORIGIN=remote
reset_target
record remote-dropped-source dbtp compile --static-analysis strict --generate-info-schema
