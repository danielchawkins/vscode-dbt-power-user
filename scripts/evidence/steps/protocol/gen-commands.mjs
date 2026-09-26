// Generates scripts/evidence/steps/protocol/commands-*.json. Usage: node scripts/evidence/steps/protocol/gen-commands.mjs
// Each file: initialize + open-and-load, then one executeCommand per (command, argument shape) with a short wait between.
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const U = "$FILE_URI(models/order_totals.sql)";
const R = "models/order_totals.sql";
const common = [
  ["[]", []],
  ["[{}]", [{}]],
  ["[uri]", [U]],
  ["[relpath]", [R]],
  ["[{uri}]", [{ uri: U }]],
  ["[{file_uri}]", [{ file_uri: U }]],
];
const extra = {
  "dbt.listNodes": [
    ["[selector +rel+]", [`+${R}+`]],
    ["[selector order_totals]", ["order_totals"]],
    ["[selector +order_totals+]", ["+order_totals+"]],
    ["[{select}]", [{ select: "+order_totals+" }]],
    ["[{selector}]", [{ selector: "+order_totals+" }]],
  ],
  "dbt.getCurrentNode": [
    ["[{uri,line,character}]", [{ uri: U, line: 0, character: 20 }]],
    ["[{uri,position}]", [{ uri: U, position: { line: 0, character: 20 } }]],
    [
      "[{textDocument,position}]",
      [{ textDocument: { uri: U }, position: { line: 0, character: 20 } }],
    ],
    ["[relpath stg_orders]", ["models/stg_orders.sql"]],
  ],
  "dbt.show": [
    ["[{uri,limit}]", [{ uri: U, limit: 3 }]],
    ["[{inline}]", [{ inline: "select 1 as one" }]],
    ["[{uri,inline}]", [{ uri: U, inline: "select 1 as one" }]],
    ["[{uri,inline,limit}]", [{ uri: U, inline: "select 1 as one", limit: 1 }]],
    ["[{sql}]", [{ sql: "select 1 as one" }]],
    ["[{select}]", [{ select: "order_totals" }]],
    ["[{selector}]", [{ selector: "order_totals" }]],
    [
      "[{uri stg_orders,limit}]",
      [{ uri: "$FILE_URI(models/stg_orders.sql)", limit: 2 }],
    ],
    [
      "[{uri,inline ref}]",
      [{ uri: U, inline: "select * from {{ ref('stg_orders') }}", limit: 2 }],
    ],
  ],
  "dbt.compileFile": [
    ["[uri stg_orders]", ["$FILE_URI(models/stg_orders.sql)"]],
  ],
};
const commands = [
  "dbt.getProjectInfo",
  "dbt.listNodes",
  "dbt.getCurrentNode",
  "dbt.compileFile",
  "dbt.show",
  "dbt.compileLsp",
  "dbt.clearTarget",
];
const init = JSON.parse(
  fs.readFileSync(path.join(here, "init-baseline.json"), "utf8"),
);
const calls = (prefix) =>
  commands.flatMap((c) =>
    [...common, ...(extra[c] ?? [])].flatMap(([label, args]) => [
      {
        request: "workspace/executeCommand",
        label: `${prefix}${c} ${label}`,
        params: { command: `${prefix}${c}`, arguments: args },
        timeoutMs: 60000,
      },
      { wait: 500 },
      // clearTarget deletes target/.lsp; let the server settle before the next command.
      ...(c === "dbt.clearTarget" || c === "dbt.compileLsp"
        ? [{ wait: 3000 }]
        : []),
    ]),
  );
const write = (name, steps) =>
  fs.writeFileSync(
    path.join(here, name),
    JSON.stringify(steps, null, 2) + "\n",
  );
write("commands-shapes.json", [
  ...init,
  { snapshot: "before-commands" },
  ...calls(""),
  { snapshot: "after-commands" },
]);
// Server started with --command-prefix dbt: the advertised form, the unprefixed form, and the prefix-only form.
const probe = (name, label, args) => ({
  request: "workspace/executeCommand",
  label: `${name} ${label}`,
  params: { command: name, arguments: args },
  timeoutMs: 60000,
});
write("commands-prefixed.json", [
  ...init,
  ...["dbtdbt.", "dbt.", "dbt"].flatMap((p) => [
    probe(`${p}getProjectInfo`, "[]", []),
    probe(`${p}compileFile`, "[uri]", [U]),
    probe(`${p}listNodes`, "[selector +order_totals+]", ["+order_totals+"]),
    probe(`${p}getCurrentNode`, "[relpath]", [R]),
    probe(`${p}show`, "[{uri,limit}]", [{ uri: U, limit: 2 }]),
  ]),
]);
