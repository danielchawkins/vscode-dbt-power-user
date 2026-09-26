# shellcheck shell=bash
# R7: how does the read path fail — no compile yet, compile without --generate-info-schema, after dbt clean,
# and with a --target-path that does not match where the info schema was written?
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
reset_target
record before-compile dbtp show --info column_lineage --output json --limit -1 --quiet
record before-compile-inline dbtp show --inline "select * from {{ info_schema('column_lineage') }}" \
  --output json --limit -1 --quiet
record before-compile-loud dbtp show --info column_lineage --output json --limit -1
reset_target
record compile-no-info-schema dbtp compile --static-analysis strict
record after-compile-no-info-schema dbtp show --info column_lineage --output json --limit -1 --quiet
record ls-target-no-info-schema /usr/bin/find target -maxdepth 3 -type d
reset_target
record compile-baseline-info-schema dbtp compile --static-analysis baseline --generate-info-schema
record after-baseline dbtp show --info column_lineage --output json --limit -1 --quiet
record after-baseline-node-columns dbtp show --info node_columns --output json --limit -1 --quiet
reset_target
record compile-strict-info-schema dbtp compile --static-analysis strict --generate-info-schema
record after-strict dbtp show --info column_lineage --output json --limit -1 --quiet
record other-target-path dbtp show --info column_lineage --output json --limit -1 --quiet --target-path target-other
record find-other-target-path /usr/bin/find target-other
record other-target-path-abs dbtp show --info column_lineage --output json --limit -1 --quiet \
  --target-path "$EVIDENCE_PROJECT/target"
record rm-info-schema-dir /bin/rm -rf target/info_schema
record after-rm-info-schema dbtp show --info column_lineage --output json --limit -1 --quiet
record recompile dbtp compile --static-analysis strict --generate-info-schema
record rm-one-parquet /bin/rm target/info_schema/v1/dbt.column_lineage.parquet
record after-rm-one-parquet dbtp show --info column_lineage --output json --limit -1 --quiet
record after-rm-one-parquet-other-view dbtp show --info models --output json --limit 1 --quiet
record recompile-2 dbtp compile --static-analysis strict --generate-info-schema
record clean dbtp clean
record ls-after-clean /usr/bin/find . -maxdepth 2 -not -path './models*' -not -path './macros*'
record after-clean dbtp show --info column_lineage --output json --limit -1 --quiet
