# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh. L4: state, execution and logging flags, one per session, on top of L1.
# Question: does --state/--defer/--favor-state (against a saved strict CLI compile), --no-defer,
# --manage-state, --no-manage-state, --dirty, --threads 1, --vars '{}', --compute <v>, --log-format json,
# --quiet or --debug make the server write column lineage, or stop it loading?
# shellcheck source=scripts/evidence/experiments/l-common.sh
source "$EVIDENCE_HERE/experiments/l-common.sh"
P="$EVIDENCE_PROJECT"

fresh
with "${L_READ_ENV[@]}"
record cli-compile-for-state dbtp compile --static-analysis strict --generate-info-schema \
  --otel-file-name cli-compile-otel.jsonl
rm -rf "$P/state-cli"
cp -R "$P/target" "$P/state-cli"
record state-cli-files /usr/bin/find state-cli -type f

fresh
session state-defer-favor edit-and-save.json "${L_BASE_ENV[@]}" -- "${L_BASE_FLAGS[@]}" \
  --state "$P/state-cli" --defer true --favor-state true
fresh
session no-defer edit-and-save.json "${L_BASE_ENV[@]}" -- "${L_BASE_FLAGS[@]}" --no-defer
fresh
session manage-state edit-and-save.json "${L_BASE_ENV[@]}" -- "${L_BASE_FLAGS[@]}" --manage-state
fresh
session no-manage-state edit-and-save.json "${L_BASE_ENV[@]}" -- "${L_BASE_FLAGS[@]}" --no-manage-state
fresh
session dirty edit-and-save.json "${L_BASE_ENV[@]}" -- "${L_BASE_FLAGS[@]}" --dirty
fresh
session threads-1 edit-and-save.json "${L_BASE_ENV[@]}" -- "${L_BASE_FLAGS[@]}" --threads 1
fresh
session vars-empty edit-and-save.json "${L_BASE_ENV[@]}" -- "${L_BASE_FLAGS[@]}" --vars '{}'
for c in inline sidecar service; do
  fresh
  session "compute-$c" edit-and-save.json "${L_BASE_ENV[@]}" -- "${L_BASE_FLAGS[@]}" --compute "$c"
done
fresh
session log-format-json edit-and-save.json "${L_BASE_ENV[@]}" -- "${L_BASE_FLAGS[@]}" --log-format json
fresh
session quiet edit-and-save.json "${L_BASE_ENV[@]}" -- "${L_BASE_FLAGS[@]}" --quiet
fresh
session debug edit-and-save.json "${L_BASE_ENV[@]}" -- "${L_BASE_FLAGS[@]}" --debug
