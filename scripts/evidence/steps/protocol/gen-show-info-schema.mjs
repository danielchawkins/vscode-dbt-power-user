// Generates scripts/evidence/steps/protocol/show-info-schema.json. Usage: node scripts/evidence/steps/protocol/gen-show-info-schema.mjs
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const U = "$FILE_URI(models/order_totals.sql)";
const init = JSON.parse(
  fs.readFileSync(path.join(here, "init-baseline.json"), "utf8"),
);
const sqls = {
  column_lineage: "select * from {{ info_schema('column_lineage') }}",
  models: "select * from {{ info_schema('models') }}",
  "column_lineage limit-in-sql":
    "select * from {{ info_schema('column_lineage') }} limit 5",
  "dbt.column_lineage raw": "select * from dbt.column_lineage",
  // node_columns is in the parse-time "Available views" list that the column_lineage error prints.
  node_columns: "select * from {{ info_schema('node_columns') }}",
  // The parquet file a CLI compile with --generate-info-schema writes, read directly (path relative to the server cwd).
  "read_parquet column_lineage":
    "select * from read_parquet('target/info_schema/v1/dbt.column_lineage.parquet')",
};
const shapes = (sql) => [
  ["[{inline}]", [{ inline: sql }]],
  ["[{inline,limit}]", [{ inline: sql, limit: 5 }]],
  ["[{uri,inline,limit}]", [{ uri: U, inline: sql, limit: 5 }]],
];
const steps = [...init];
for (const [name, sql] of Object.entries(sqls))
  for (const [label, args] of shapes(sql))
    steps.push(
      {
        request: "workspace/executeCommand",
        label: `dbt.show ${name} ${label}`,
        params: { command: "dbt.show", arguments: args },
        timeoutMs: 60000,
      },
      { wait: 500 },
    );
steps.push({ snapshot: "after-show" });
fs.writeFileSync(
  path.join(here, "show-info-schema.json"),
  JSON.stringify(steps, null, 2) + "\n",
);
