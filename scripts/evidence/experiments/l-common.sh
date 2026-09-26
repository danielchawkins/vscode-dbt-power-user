# shellcheck shell=bash
# Sourced by the l*-*.sh experiments (after run.sh defines record, lsp, with, step, node_bin and lib.sh).
# session <label> <steps.json> [VAR=val ...] -- [extra dbt lsp args...]: one LSP session with the
# mandatory args, then the same post-session steps every time. The listed env replaces the `with` env for the
# session only; the reads afterwards run with FUSION_POWER_USER_SCHEMA_ORIGIN=local only.
# Post steps, in order (finds/notes/grep before any `dbt show`, which writes its own logs):
#   find-lineage (target/**/*lineage*), find-outside-target (lineage/info_schema/parquet outside target/),
#   transcript-notes (l-transcript-notes.mjs), grep-logs (grep -c per pattern per file in logs/),
#   lineage (default target), lineage-lsp-target (--target-path target/.lsp).
# Fusion's logs/ is copied to <out>/session-logs/<label>/ right after the session.
# shellcheck disable=SC2154 # step, node_bin come from run.sh
L_BASE_ARGS=(--project-dir "$EVIDENCE_PROJECT" --profiles-dir "$EVIDENCE_PROJECT" --no-version-check
  --command-prefix "" --log-level-file trace)
# shellcheck disable=SC2034 # read by the experiments
L_BASE_ENV=(FUSION_POWER_USER_SCHEMA_ORIGIN=local DBT_LSP_USE_TARGET_LSP=1)
# shellcheck disable=SC2034
L_BASE_FLAGS=(--static-analysis strict --generate-info-schema)
L_READ_ENV=(FUSION_POWER_USER_SCHEMA_ORIGIN=local)

# fresh: no target/ or logs/, order_totals back to its original SQL (edit-and-save.json rewrites it on disk).
fresh() {
  reset_target
  set_model order_totals "$ORDER_TOTALS_ORIG"
}

session() {
  local label="$1" steps="$2"
  shift 2
  local env=()
  while [[ $# -gt 0 && "$1" != -- ]]; do
    env+=("$1")
    shift
  done
  [[ $# -gt 0 ]] && shift
  with ${env[@]+"${env[@]}"}
  lsp "$label" "$steps" "${L_BASE_ARGS[@]}" --otel-file-name "$label-otel.jsonl" "$@"
  local lspdir
  lspdir="$EVIDENCE_OUT/steps/$(printf '%02d' "$step")-$label"
  if [[ -d "$EVIDENCE_PROJECT/logs" ]]; then
    mkdir -p "$EVIDENCE_OUT/session-logs"
    cp -R "$EVIDENCE_PROJECT/logs" "$EVIDENCE_OUT/session-logs/$label"
  fi
  with "${L_READ_ENV[@]}"
  record "$label-find-lineage" /usr/bin/find target -name '*lineage*'
  record "$label-find-outside-target" /usr/bin/find . -path ./target -prune -o \
    \( -name '*lineage*' -o -name '*info_schema*' -o -name '*.parquet' \) -print
  record "$label-transcript-notes" "$node_bin" "$EVIDENCE_HERE/experiments/l-transcript-notes.mjs" \
    "$lspdir/lsp-transcript.jsonl"
  # Counts: grep -c for each pattern, plus `lineage` lines that do not mention the project name lineage_probe.
  # shellcheck disable=SC2016 # expanded by the recorded sh, not here
  record "$label-grep-logs" /bin/sh -c 'for f in logs/*; do
for p in lineage info_schema ArtifactWritten column_lineage; do
printf "%s\t%s\t%s\n" "$(/usr/bin/grep -c -- "$p" "$f")" "$p" "$f"; done
printf "%s\t%s\t%s\n" "$(/usr/bin/grep -- lineage "$f" | /usr/bin/grep -vc lineage_probe)" "lineage-not-lineage_probe" "$f"
done'
  lineage "$label-lineage"
  record "$label-lineage-lsp-target" dbtp show --target-path target/.lsp --info column_lineage \
    --output json --limit -1 --quiet
}
