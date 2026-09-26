# shellcheck shell=bash
# R1: after one strict compile with --generate-info-schema, what exactly does `dbt show --info column_lineage`
# write to stdout and stderr for every --output value, with and without --quiet, at --limit default/-1/0/5?
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
record compile dbtp compile --static-analysis strict --generate-info-schema
save_target after-compile
for fmt in table csv tsv json ndjson yml selector name path; do
  for q in quiet loud; do
    qflag=()
    [[ $q == quiet ]] && qflag=(--quiet)
    record "$fmt-$q-ldefault" dbtp show --info column_lineage --output "$fmt" ${qflag[@]+"${qflag[@]}"}
    for lim in -1 0 5; do
      record "$fmt-$q-l$lim" dbtp show --info column_lineage --output "$fmt" --limit "$lim" ${qflag[@]+"${qflag[@]}"}
    done
  done
done
