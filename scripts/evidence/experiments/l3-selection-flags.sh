# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh. L3: selection flags, one per session, on top of L1.
# Question: does --selector, -s order_totals, -s +order_totals, --exclude or --resource-type model make the
# server write column lineage?
# shellcheck source=scripts/evidence/experiments/l-common.sh
source "$EVIDENCE_HERE/experiments/l-common.sh"

fresh
with
# shellcheck disable=SC2016
record write-selectors /bin/sh -c 'printf "selectors:\n  - name: ot\n    definition: \"+order_totals\"\n" > selectors.yml
cat selectors.yml'
session selector edit-and-save.json "${L_BASE_ENV[@]}" -- "${L_BASE_FLAGS[@]}" --selector ot
rm -f "$EVIDENCE_PROJECT/selectors.yml"

fresh
session select-order-totals edit-and-save.json "${L_BASE_ENV[@]}" -- "${L_BASE_FLAGS[@]}" -s order_totals

fresh
session select-upstream edit-and-save.json "${L_BASE_ENV[@]}" -- "${L_BASE_FLAGS[@]}" -s +order_totals

fresh
session exclude-hard edit-and-save.json "${L_BASE_ENV[@]}" -- "${L_BASE_FLAGS[@]}" --exclude hard

fresh
session resource-type-model edit-and-save.json "${L_BASE_ENV[@]}" -- "${L_BASE_FLAGS[@]}" --resource-type model
