# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh.
# M2: does the language server honour static_analysis from dbt_project.yml, and does it read an env var for it?
# `dbt lsp --help` shows no [env: ...] binding for --static-analysis (compile's help shows DBT_STATIC_ANALYSIS).
# Signal: the editor-features.json responses (strict answers column hover/references/rename; baseline does not).
with FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1
args=(--project-dir "$EVIDENCE_PROJECT" --profiles-dir "$EVIDENCE_PROJECT" --lint-enabled false
  --no-version-check --command-prefix "" --log-level-file trace)
cp "$EVIDENCE_PROJECT/dbt_project.yml" "$EVIDENCE_OUT/dbt_project.yml.orig"

reset_target
lsp no-flag editor-features.json "${args[@]}" --otel-file-name m2-no-flag.jsonl
reset_target
lsp flag-strict editor-features.json "${args[@]}" --static-analysis strict --otel-file-name m2-flag-strict.jsonl
reset_target
with FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1 DBT_ENGINE_STATIC_ANALYSIS=strict
lsp env-engine-strict editor-features.json "${args[@]}" --otel-file-name m2-env-engine.jsonl
with FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1
reset_target
printf '%s\n' 'models:' '  lineage_probe:' '    +static_analysis: strict' >> "$EVIDENCE_PROJECT/dbt_project.yml"
lsp project-models-strict editor-features.json "${args[@]}" --otel-file-name m2-project.jsonl
reset_target
lsp project-models-strict-flag-baseline editor-features.json "${args[@]}" --static-analysis baseline \
  --otel-file-name m2-project-flag-baseline.jsonl
cp "$EVIDENCE_OUT/dbt_project.yml.orig" "$EVIDENCE_PROJECT/dbt_project.yml"
