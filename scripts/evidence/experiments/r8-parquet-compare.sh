# shellcheck shell=bash
# R8: do the raw lineage parquet files carry any column or row that `dbt show --info column_lineage` does not?
with FUSION_POWER_USER_SCHEMA_ORIGIN=local
# run.sh's PATH has no uv; the operator shell's `command -v uvx` is a mise shim, this is the real binary.
UVX=/Users/daniel/.local/bin/uvx
# stdout_of <label>: stdout.txt of the most recent step with that label.
stdout_of() {
  local d
  for d in "$EVIDENCE_OUT"/steps/*-"$1"; do :; done
  printf '%s/stdout.txt' "$d"
}
record uvx-on-clean-path uvx --version
record uvx-abs "$UVX" --version
record compile dbtp compile --static-analysis strict --generate-info-schema
record find-parquet /usr/bin/find target -name '*.parquet'
record show-json dbtp show --info column_lineage --output json --limit -1 --quiet
show_out="$(stdout_of show-json)"
record show-node-columns dbtp show --info node_columns --output json --limit -1 --quiet
nc_out="$(stdout_of show-node-columns)"
# Prints, per file: arrow schema, parquet key-value metadata, row count, every row as JSON; then the
# column and row multiset differences against the show json. Private/index column names are first mapped
# onto the show names (RENAME); ingested_at is excluded from the row comparison and printed separately.
PQ_SCRIPT='
import json, sys, glob, pyarrow.parquet as pq
RENAME = {"from_node_unique_id": "parent_node_unique_id", "from_column_name": "parent_column_name",
  "to_node_unique_id": "child_node_unique_id", "to_column_name": "child_column_name",
  "lineage_kind": "evolution", "unique_id": "node_unique_id", "column_type": "data_type_inferred"}
show = json.load(open(sys.argv[1]))
show_cols = list(show[0].keys()) if show else []
def key(r, cols):
    return json.dumps({c: (None if r.get(c) is None else str(r.get(c))) for c in cols}, sort_keys=True)
for pattern in sys.argv[2:]:
    for path in sorted(glob.glob(pattern)):
        t = pq.read_table(path)
        md = pq.read_metadata(path)
        print("=== file", path)
        print("rows", t.num_rows, "row_groups", md.num_row_groups, "created_by", md.created_by)
        print("schema:")
        for f in t.schema:
            print("  ", f.name, f.type, "nullable" if f.nullable else "not-null")
        kv = t.schema.metadata or {}
        print("kv_metadata_keys", sorted(k.decode() for k in kv))
        for k, v in sorted(kv.items()):
            print("  kv", k.decode(), v.decode()[:400])
        raw = t.to_pylist()
        for r in raw:
            print("row", json.dumps(r, default=str, sort_keys=True))
        rows = [{RENAME.get(k, k): v for k, v in r.items()} for r in raw]
        cols = [RENAME.get(f.name, f.name) for f in t.schema]
        print("renamed_cols", cols)
        print("cols_only_in_parquet", [c for c in cols if c not in show_cols])
        print("cols_only_in_show", [c for c in show_cols if c not in cols])
        common = [c for c in cols if c in show_cols and c != "ingested_at"]
        a = sorted(key(r, common) for r in rows)
        b = sorted(key(r, common) for r in show)
        print("compare_on", common)
        print("rows_only_in_parquet", [x for x in a if x not in b])
        print("rows_only_in_show", [x for x in b if x not in a])
        print("multiset_equal", a == b)
        if "ingested_at" in cols and "ingested_at" in show_cols:
            print("ingested_at parquet", sorted({str(r["ingested_at"]) for r in rows}))
            print("ingested_at show", sorted({r["ingested_at"] for r in show}))
'
record pq-info-schema "$UVX" --quiet --with pyarrow python -c "$PQ_SCRIPT" "$show_out" \
  target/info_schema/v1/dbt.column_lineage.parquet
record pq-private-compile "$UVX" --quiet --with pyarrow python -c "$PQ_SCRIPT" "$show_out" \
  'target/private/metadata/compile/column_lineage/*.parquet'
record pq-private-index "$UVX" --quiet --with pyarrow python -c "$PQ_SCRIPT" "$show_out" \
  'target/private/index/dbt.column_lineage.parquet'
record pq-node-columns "$UVX" --quiet --with pyarrow python -c "$PQ_SCRIPT" "$nc_out" \
  target/info_schema/v1/dbt.node_columns.parquet 'target/private/metadata/compile/columns/*.parquet'
# The index is not written by compile in this binary; the help and binary strings name --write-index and build.
record compile-write-index dbtp compile --static-analysis strict --generate-info-schema --write-index
record find-index-after-write-index /usr/bin/find target -path '*index*'
record build dbtp build --static-analysis strict --generate-info-schema
record find-index-after-build /usr/bin/find target -path '*index*'
record show-json-after-build dbtp show --info column_lineage --output json --limit -1 --quiet
show_out="$(stdout_of show-json-after-build)"
record pq-after-build "$UVX" --quiet --with pyarrow python -c "$PQ_SCRIPT" "$show_out" \
  target/info_schema/v1/dbt.column_lineage.parquet 'target/private/metadata/compile/column_lineage/*.parquet' \
  'target/private/index/*column_lineage*.parquet'
