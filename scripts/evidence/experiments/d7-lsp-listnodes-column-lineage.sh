# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# D7: how does the official dbt extension get column lineage? Its bundle (dbtLabsInc.dbt 0.109.1) sends
# `workspace/executeCommand` `dbt.listNodes` with `["@<unique_id>", "+column:<unique_id>.<column>+"]` and never reads
# the `column_lineage` info schema. This asks the same of `dbt lsp` with no CLI compile, then after an edit that adds
# `biggest` to order_totals as an unsaved didChange and then a save, with totals_star = `select *` open.
# Decision rule, fixed before running: if listNodes returns column-grain lineage (upstream and downstream) with no
# CLI compile and reflects the edit, the panel reads lineage from the language server and the CLI refresh on save
# is deleted; otherwise the CLI path stays.
with FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1
record 01-setup-warehouse dbtp run-operation setup_raw
rm -rf "$EVIDENCE_PROJECT/target"
lsp 02-listnodes-no-cli listnodes-column-lineage.json \
  --project-dir "$EVIDENCE_PROJECT" --profiles-dir "$EVIDENCE_PROJECT" --lint-enabled false \
  --static-analysis strict --no-version-check --command-prefix ""
