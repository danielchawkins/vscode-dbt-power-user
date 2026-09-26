#!/usr/bin/env bash
# Operator driver (not an experiment): runs the l*-experiments in order into $TMPDIR/fpu-ev/lsp-flags and writes
# a summary per run. Usage: scripts/evidence/experiments/l-run-all.sh [experiment...]
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
export DBT_BIN=/Users/daniel/.local/share/mise/installs/aqua-getdbt-com-dbt-fusion/2.0.6/dbt
root="${TMPDIR:-/tmp}/fpu-ev/lsp-flags"
mkdir -p "$root"
names=("$@")
[[ ${#names[@]} -gt 0 ]] || names=(l1-baseline l2-output-flags l3-selection-flags l4-state-exec-log-flags
  l6-static-analysis-features l7-shared-cli-target)
for n in "${names[@]}"; do
  "$here/run.sh" "$n" "$root" > "$root/$n.runlog" 2>&1 || echo "run.sh $n exit=$?" >> "$root/$n.runlog"
  node "$here/summarize.mjs" "$root/$n" > "$root/$n.summary" 2>&1 || true
done
echo finished > "$root/.done"
