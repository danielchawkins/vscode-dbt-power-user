# shellcheck shell=bash
# R2: with --output json, does stdout stay parseable JSON under each --log-format, with and without --quiet?
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
record compile dbtp compile --static-analysis strict --generate-info-schema
for lf in default text json otel; do
  record "lf-$lf-quiet" dbtp show --info column_lineage --output json --limit -1 --log-format "$lf" --quiet
  record "lf-$lf-loud" dbtp show --info column_lineage --output json --limit -1 --log-format "$lf"
done
record lf-json-quiet-ndjson dbtp show --info column_lineage --output ndjson --limit -1 --log-format json --quiet
record lf-json-loud-ndjson dbtp show --info column_lineage --output ndjson --limit -1 --log-format json
