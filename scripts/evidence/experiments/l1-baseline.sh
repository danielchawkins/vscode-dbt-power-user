# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh. L1: baseline for every l*-experiment.
# Question: with `--static-analysis strict --generate-info-schema`, local sources and DBT_LSP_USE_TARGET_LSP=1,
# does an edit/save/compileLsp/compileFile session write column lineage anywhere?
# shellcheck source=scripts/evidence/experiments/l-common.sh
source "$EVIDENCE_HERE/experiments/l-common.sh"
fresh
session baseline edit-and-save.json "${L_BASE_ENV[@]}" -- "${L_BASE_FLAGS[@]}"
