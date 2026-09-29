# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# D6: does exploring and renaming depend on the CLI's column_lineage view? A full strict compile, an edit to
# order_totals and today's refresh `-s +order_totals` leave the view without downstream edges. The language server
# session then asks for references and rename of the alias `total` across order_totals and totals_downstream.
# Decision rule, fixed before running: if references and rename answer across both files with the view narrowed,
# rename and references do not depend on the view and the refresh rule concerns only the lineage panel.
with FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1
record 01-setup-warehouse dbtp run-operation setup_raw
record 02-full dbtp compile --static-analysis strict --generate-info-schema
set_model order_totals "$ORDER_TOTALS_EDIT"
record 03-refresh dbtp compile -s +order_totals --static-analysis strict --generate-info-schema
record 04-down dbtp show --inline "select child_node_unique_id from {{ info_schema('column_lineage') }}
where parent_node_unique_id = 'model.lineage_probe.order_totals'" --output json --limit -1 --quiet
lsp 05-editor editor-features.json \
  --project-dir "$EVIDENCE_PROJECT" --profiles-dir "$EVIDENCE_PROJECT" --lint-enabled false \
  --static-analysis strict --no-version-check --command-prefix ""
