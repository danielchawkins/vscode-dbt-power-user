# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh.
# L8: where does a language-server session write compiled SQL, and what moves it? Each session opens
# order_totals.sql, waits, then saves an edit. files-after.txt lists every file under target/ afterwards.
# Variants: DBT_LSP_USE_TARGET_LSP unset; =1 (what the extension sets); =1 with --target-path target-shared;
# unset with --target-path target-shared.
# shellcheck source=scripts/evidence/experiments/l-common.sh
source "$EVIDENCE_HERE/experiments/l-common.sh"
L=(FUSION_POWER_USER_SCHEMA_ORIGIN=local)

fresh
session env-unset edit-and-save.json "${L[@]}" -- "${L_BASE_FLAGS[@]}"
fresh
session env-1 edit-and-save.json "${L_BASE_ENV[@]}" -- "${L_BASE_FLAGS[@]}"
fresh
session env-1-target-path edit-and-save.json "${L_BASE_ENV[@]}" -- "${L_BASE_FLAGS[@]}" --target-path target-shared
record list-after-env-1-target-path /usr/bin/find target-shared -name "*.sql"
rm -rf "$EVIDENCE_PROJECT/target-shared"
fresh
session env-unset-target-path edit-and-save.json "${L[@]}" -- "${L_BASE_FLAGS[@]}" --target-path target-shared
# files-after.txt covers target/ and logs/ only; list the alternative target path too.
record list-target-shared /usr/bin/find target-shared -name '*.sql'
rm -rf "$EVIDENCE_PROJECT/target-shared"
