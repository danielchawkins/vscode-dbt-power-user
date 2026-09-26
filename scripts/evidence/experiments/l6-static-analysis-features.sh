# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh. L6: static-analysis mode vs native editor features (editor-features.json).
# Question: which of hover/definition/references/rename answer under strict, strict without
# --generate-info-schema, baseline, off and unsafe; and does any mode write column lineage?
# shellcheck source=scripts/evidence/experiments/l-common.sh
source "$EVIDENCE_HERE/experiments/l-common.sh"

fresh
session editor-strict editor-features.json "${L_BASE_ENV[@]}" -- "${L_BASE_FLAGS[@]}"
fresh
session editor-strict-no-gis editor-features.json "${L_BASE_ENV[@]}" -- --static-analysis strict
for mode in baseline off unsafe; do
  fresh
  session "editor-$mode" editor-features.json "${L_BASE_ENV[@]}" -- --static-analysis "$mode" --generate-info-schema
done
