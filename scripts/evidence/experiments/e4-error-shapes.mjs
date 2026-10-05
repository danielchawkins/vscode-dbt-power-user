// E4, error shapes and timings of `show`, `compileFile`, `getCurrentNode` and `listNodes`. Decision rule (fixed
// before running): every observed failure maps to one FusionCommandError kind: a JSON-RPC error or a non-null
// `error` field is `server`; no answer within the probe timeout is `timeout`; `listNodes` with
// {"error":"No nodes found","error_kind":"lineage_query_failed"} is an empty result; `show` with
// {columns:null,data:null,error} is `server` with the error text. A shape that fits none is reported as a new kind.
// Each command's deadline is 4x its slowest sample on the target, rounded up to 5 s, at least 5 s; `show` has none.
import path from "node:path";
import { p50, p95, setup } from "./adoption.mjs";

const ctx = await setup("e4-error-shapes");
const { lib, root, config } = ctx;
const server = await ctx.start();
await ctx.load(server, config.files.model);
await lib.sleep(1000);
const uri = (rel) => lib.fileUri(path.join(root, rel));
const happy = {
  "dbt.show": [{ inline: config.showInline, limit: 1 }],
  "dbt.compileFile": [uri(config.files.model)],
  "dbt.getCurrentNode": [config.files.model],
  "dbt.listNodes": [`+${config.uniqueId}+`],
};
const failures = {
  "dbt.show": {
    "sql syntax": [{ inline: "selec 1 frm", limit: 1 }],
    "missing ref": [
      { inline: "select * from {{ ref('fpu_no_such_model') }}", limit: 1 },
    ],
    "jinja syntax": [{ inline: "select {{ 1 ", limit: 1 }],
    "missing relation": [
      { inline: "select * from fpu_no_such_relation", limit: 1 },
    ],
    "unknown uri": [{ uri: uri("models/fpu_missing.sql"), limit: 1 }],
    "no argument": [],
  },
  "dbt.compileFile": {
    "unknown uri": [uri("models/fpu_missing.sql")],
    "yaml file": [uri(config.files.lensAlso[0])],
    "relative path": [config.files.model],
    "no argument": [],
  },
  "dbt.getCurrentNode": {
    "unknown path": ["models/fpu_missing.sql"],
    "absolute uri": [uri(config.files.model)],
    "no argument": [],
  },
  "dbt.listNodes": {
    "no match": ["fpu_no_such_model"],
    "bad selector": ["+++"],
    "empty list": [],
    "object argument": [{ select: "orders" }],
  },
};

const kindOf = (command, e) => {
  if (e.error?.timeout) return "timeout";
  if (e.error) return "server";
  const r = e.result;
  if (
    command === "dbt.listNodes" &&
    r?.error === "No nodes found" &&
    r?.error_kind === "lineage_query_failed"
  ) {
    return "empty";
  }
  if (r && typeof r === "object" && r.error) return "server";
  if (r === null || r === undefined) return "null result";
  if (command === "dbt.show" && r.columns === null)
    return "no columns, no error";
  if (command === "dbt.getCurrentNode" && !r.node) return "no node";
  return "ok";
};
const shapeOf = (v) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(
        Object.entries(v).map(([k, x]) => [
          k,
          x === null ? null : Array.isArray(x) ? "array" : typeof x,
        ]),
      )
    : v === null
      ? null
      : typeof v;

const timings = {};
for (const [command, args] of Object.entries(happy)) {
  const samples = [];
  let last;
  for (let i = 0; i < 5; i++) {
    last = await server.exec(command, args, { timeoutMs: 300000 });
    samples.push(last.ms);
  }
  const slowest = Math.max(...samples);
  timings[command] = {
    samples,
    p50: p50(samples),
    p95: p95(samples),
    kind: kindOf(command, last),
    deadlineMs:
      command === "dbt.show"
        ? null
        : Math.max(5000, Math.ceil((4 * slowest) / 5000) * 5000),
  };
}
const shapes = {};
for (const [command, cases] of Object.entries(failures)) {
  for (const [label, args] of Object.entries(cases)) {
    const e = await server.exec(command, args, { timeoutMs: 120000 });
    shapes[`${command} ${label}`] = {
      args,
      ms: e.ms,
      kind: kindOf(command, e),
      shape: e.error
        ? { jsonRpcError: e.error.code ?? "timeout" }
        : shapeOf(e.result),
      error: e.error ?? e.result?.error ?? null,
      errorKind: e.result?.error_kind ?? null,
    };
  }
}
await server.stop();

const known = new Set(["server", "timeout", "empty", "ok"]);
const newKinds = [
  ...new Set(
    Object.values(shapes)
      .map((s) => s.kind)
      .filter((k) => !known.has(k)),
  ),
];
const deadlines = Object.fromEntries(
  Object.entries(timings).map(([c, t]) => [c, t.deadlineMs]),
);
const decision = newKinds.length
  ? `kinds server/timeout/notRunning/cancelled plus unmapped shapes ${newKinds.join(", ")}`
  : "every failure maps to server, timeout or an empty listNodes result";
const file = ctx.write({
  rule: "see header",
  timings,
  shapes,
  newKinds,
  deadlines,
  decision,
});
ctx.decide(`${decision}; deadlines ${JSON.stringify(deadlines)} -> ${file}`);
process.exit(0);
