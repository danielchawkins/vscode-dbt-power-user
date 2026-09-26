# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh.
# M1: where can static_analysis be set, which setting wins, and does the DBT_ENGINE_ prefix work?
# Signal: models/probe_strict.sql selects a column that does not exist. Only strict analysis resolves columns, so
# `UnresolvedIdentifier (dbt0227)` in compile output means strict was in effect for that model. No
# --generate-info-schema, so the signal does not depend on the info schema.
# Docs: https://docs.getdbt.com/docs/build/about-static-analysis?version=2 (config on models; --static-analysis
# overrides all model config) and https://docs.getdbt.com/reference/global-configs/about-global-configs?version=2
# (precedence CLI > env > dbt_project.yml; env vars use DBT_ENGINE_). Source: crates/dbt-main/src/vars.rs copies
# DBT_ENGINE_<X> to DBT_<X> when DBT_<X> is unset; crates/dbt-clap-core/src/lib.rs binds --static-analysis to
# DBT_STATIC_ANALYSIS for CLI subcommands.
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
set_model probe_strict "select no_such_column from {{ ref('stg_orders') }}"
cp "$EVIDENCE_PROJECT/dbt_project.yml" "$EVIDENCE_OUT/dbt_project.yml.orig"
project() {
  cp "$EVIDENCE_OUT/dbt_project.yml.orig" "$EVIDENCE_PROJECT/dbt_project.yml"
  printf '%s\n' "$@" >> "$EVIDENCE_PROJECT/dbt_project.yml"
}
compile_probe() { record "$1" dbtp compile -s +probe_strict "${@:2}"; }

compile_probe default
compile_probe cli-baseline --static-analysis baseline
compile_probe cli-strict --static-analysis strict
with FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_ENGINE_STATIC_ANALYSIS=strict
compile_probe env-engine-strict
compile_probe env-engine-strict-cli-baseline --static-analysis baseline
with FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_STATIC_ANALYSIS=baseline DBT_ENGINE_STATIC_ANALYSIS=strict
compile_probe env-legacy-baseline-engine-strict
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
project 'models:' '  lineage_probe:' '    +static_analysis: strict'
compile_probe project-models-strict
compile_probe project-models-strict-cli-baseline --static-analysis baseline
with FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_ENGINE_STATIC_ANALYSIS=baseline
compile_probe project-models-strict-env-engine-baseline
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
project 'flags:' '  static_analysis: strict'
compile_probe project-flags-strict
project 'models:' '  lineage_probe:' '    +static_analysis: baseline' '    probe_strict:' '      +static_analysis: strict'
compile_probe project-parent-baseline-child-strict
cp "$EVIDENCE_OUT/dbt_project.yml.orig" "$EVIDENCE_PROJECT/dbt_project.yml"
