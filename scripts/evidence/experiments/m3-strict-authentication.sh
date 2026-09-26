# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh.
# M3: does strict analysis depend on authentication or the licence path on this machine?
# Docs say unauthenticated strict runs fall back to baseline. The open-source crates only contain
# NoOpLicenseFetcher (crates/dbt-login/src/license_fetcher.rs); the shipped binary contains trial-licence strings
# (DBT_SKIP_REMOTE_LICENSE, DBT_CLIENT_INSTALL_DATE, a trial-licenses URL, "14-day trial has ended",
# "Continuing without dbt platform. Strict static analysis will be unavailable.").
# Signal: dbt0227 on models/probe_strict.sql (see M1). `dbt login status` records the auth state first.
set_model probe_strict "select no_such_column from {{ ref('stg_orders') }}"
mkdir -p "$EVIDENCE_OUT/empty-home"
record login-status "$DBT_BIN" login status
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
record strict-real-home dbtp compile -s +probe_strict --static-analysis strict --log-level-file trace
with FUSION_POWER_USER_SCHEMA_ORIGIN=local HOME="$EVIDENCE_OUT/empty-home"
record login-status-empty-home "$DBT_BIN" login status
record strict-empty-home dbtp compile -s +probe_strict --static-analysis strict
with FUSION_POWER_USER_SCHEMA_ORIGIN=local HOME="$EVIDENCE_OUT/empty-home" DBT_SKIP_REMOTE_LICENSE=1
record strict-empty-home-skip-remote dbtp compile -s +probe_strict --static-analysis strict
with FUSION_POWER_USER_SCHEMA_ORIGIN=local HOME="$EVIDENCE_OUT/empty-home" DBT_CLIENT_INSTALL_DATE=2024-01-01
record strict-empty-home-old-install-date dbtp compile -s +probe_strict --static-analysis strict
with FUSION_POWER_USER_SCHEMA_ORIGIN=local HOME="$EVIDENCE_OUT/empty-home" DBT_CLIENT_INSTALL_DATE=2024-01-01T00:00:00Z
record strict-empty-home-old-install-datetime dbtp compile -s +probe_strict --static-analysis strict
record list-empty-home-after "/usr/bin/find" "$EVIDENCE_OUT/empty-home" -print
