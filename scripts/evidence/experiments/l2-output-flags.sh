# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh. L2: output-location and artifact flags, one per session, on top of L1.
# Question: does --info-schema-dir, --target-path, --metadata-dir, --write-json, --write-catalog or
# --otel-parquet-file-name make the server write column lineage (and where)?
# shellcheck source=scripts/evidence/experiments/l-common.sh
source "$EVIDENCE_HERE/experiments/l-common.sh"
P="$EVIDENCE_PROJECT"

fresh
session info-schema-dir edit-and-save.json "${L_BASE_ENV[@]}" -- "${L_BASE_FLAGS[@]}" \
  --info-schema-dir "$P/alt-is"
record info-schema-dir-read dbtp show --info-schema-dir "$P/alt-is" --info column_lineage \
  --output json --limit -1 --quiet

fresh
session target-path edit-and-save.json "${L_BASE_ENV[@]}" -- "${L_BASE_FLAGS[@]}" --target-path alt-tp
record target-path-read dbtp show --target-path alt-tp --info column_lineage --output json --limit -1 --quiet
record target-path-read-lsp dbtp show --target-path alt-tp/.lsp --info column_lineage --output json \
  --limit -1 --quiet
record target-path-files /usr/bin/find alt-tp -type f

fresh
session metadata-dir edit-and-save.json "${L_BASE_ENV[@]}" -- "${L_BASE_FLAGS[@]}" --metadata-dir "$P/alt-md"
record metadata-dir-files /usr/bin/find alt-md -type f

fresh
session write-json edit-and-save.json "${L_BASE_ENV[@]}" -- "${L_BASE_FLAGS[@]}" --write-json

fresh
session write-catalog edit-and-save.json "${L_BASE_ENV[@]}" -- "${L_BASE_FLAGS[@]}" --write-catalog

fresh
session otel-parquet edit-and-save.json "${L_BASE_ENV[@]}" -- "${L_BASE_FLAGS[@]}" \
  --otel-parquet-file-name otel-lsp.parquet
