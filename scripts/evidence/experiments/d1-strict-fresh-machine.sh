# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# D1: does strict analysis work unauthenticated on a fresh machine? A fresh machine is an empty HOME with empty
# XDG config, data and cache dirs and TMPDIR inside it, and no dbt platform variables (run.sh's `env -i`).
# Signals: dbt0227 on models/probe_strict.sql (as M1), then 32 lineage rows from a full strict compile.
# Decision rule, fixed before running: strict works if the fresh-HOME probe exits 1 with dbt0227 and the full
# compile's `show --info column_lineage` returns rows; then no change. Otherwise column lineage reports
# `strictUnavailable` and the docs say strict needs `dbt login`.
fresh="$EVIDENCE_OUT/fresh-home"
mkdir -p "$fresh/tmp"
with FUSION_POWER_USER_SCHEMA_ORIGIN=local HOME="$fresh" TMPDIR="$fresh/tmp" \
  XDG_CONFIG_HOME="$fresh/.config" XDG_DATA_HOME="$fresh/.local/share" XDG_CACHE_HOME="$fresh/.cache"
record login-status "$DBT_BIN" login status
set_model probe_strict "select no_such_column from {{ ref('stg_orders') }}"
record strict-probe dbtp compile -s +probe_strict --static-analysis strict
rm "$EVIDENCE_PROJECT/models/probe_strict.sql"
record strict-full dbtp compile --static-analysis strict --generate-info-schema
lineage strict-full-lineage
without
record list-fresh-home-after /usr/bin/find "$fresh" -print
