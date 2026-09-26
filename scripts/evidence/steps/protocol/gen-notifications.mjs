// Generates scripts/evidence/steps/protocol/notifications.json. Usage: node scripts/evidence/steps/protocol/gen-notifications.mjs
// After load, each phase: one notification (or cancel), a 6 s settle wait labelled with the phase, then a target/ snapshot.
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const U = "$FILE_URI(models/order_totals.sql)";
const NEW = "$FILE_URI(models/new_model.sql)";
const ORIG =
  "select customer_id, sum(amount) as total, count(*) as n, max(status) as last_status\nfrom {{ ref('stg_orders') }}\ngroup by customer_id\n";
const EDIT = ORIG.replace(
  "as last_status",
  "as last_status, max(amount) as biggest",
);
const init = JSON.parse(
  fs.readFileSync(path.join(here, "init-baseline.json"), "utf8"),
);
let n = 0;
const phase = (label, ...actions) => [
  ...actions,
  { wait: 6000, label: `settle ${label}` },
  {
    snapshot: `${String(++n).padStart(2, "0")}-${label.replace(/[^a-z0-9]+/gi, "-")}`,
  },
];
const notify = (method, params, label) => ({ notify: method, params, label });
const watched = (uri, type) =>
  notify("workspace/didChangeWatchedFiles", { changes: [{ uri, type }] });
const cancel = (label, command, args) => [
  {
    request: "workspace/executeCommand",
    label: `${label} (cancelled)`,
    params: { command, arguments: args },
    async: true,
    timeoutMs: 30000,
  },
  notify("$/cancelRequest", { id: "$LAST_ID" }),
];
const steps = [
  ...init,
  { wait: 3000, label: "settle after load" },
  { snapshot: "00-loaded" },
  ...phase(
    "didSave no text unchanged",
    notify("textDocument/didSave", { textDocument: { uri: U } }),
  ),
  ...phase(
    "didSave text unchanged",
    notify("textDocument/didSave", { textDocument: { uri: U }, text: ORIG }),
  ),
  ...phase(
    "disk edit then didSave no text",
    { writeFile: "models/order_totals.sql", text: EDIT },
    notify("textDocument/didSave", { textDocument: { uri: U } }),
  ),
  ...phase(
    "disk revert then didSave text",
    { writeFile: "models/order_totals.sql", text: ORIG },
    notify("textDocument/didSave", { textDocument: { uri: U }, text: ORIG }),
  ),
  ...phase("didChangeWatchedFiles changed unchanged file", watched(U, 2)),
  ...phase(
    "disk edit then didChangeWatchedFiles changed",
    { writeFile: "models/order_totals.sql", text: EDIT },
    watched(U, 2),
  ),
  ...phase(
    "didChangeWatchedFiles created",
    { writeFile: "models/new_model.sql", text: "select 1 as id\n" },
    watched(NEW, 1),
  ),
  ...phase(
    "didChangeWatchedFiles deleted",
    { deleteFile: "models/new_model.sql" },
    watched(NEW, 3),
  ),
  ...phase(
    "didChangeConfiguration dbt settings",
    notify("workspace/didChangeConfiguration", {
      settings: { dbt: { lsp: { linter: { enabled: false } } } },
    }),
  ),
  ...phase(
    "didChangeConfiguration null",
    notify("workspace/didChangeConfiguration", { settings: null }),
  ),
  ...phase(
    "didClose",
    notify("textDocument/didClose", { textDocument: { uri: U } }),
  ),
  ...phase(
    "cancel show",
    ...cancel("dbt.show [{uri,limit}]", "dbt.show", [{ uri: U, limit: 2 }]),
  ),
  ...phase(
    "cancel compileFile",
    ...cancel("dbt.compileFile [uri]", "dbt.compileFile", [U]),
  ),
  ...phase(
    "cancel listNodes",
    ...cancel("dbt.listNodes [+order_totals+]", "dbt.listNodes", [
      "+order_totals+",
    ]),
  ),
];
fs.writeFileSync(
  path.join(here, "notifications.json"),
  JSON.stringify(steps, null, 2) + "\n",
);
