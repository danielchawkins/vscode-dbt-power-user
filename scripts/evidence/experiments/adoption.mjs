// Shared setup for the language server adoption experiments (`e1-…e9-*.mjs`). Each experiment fixes its decision
// rule in its header comment, writes one redacted JSON file and prints one `DECISION` line.
//   node <experiment>.mjs [--target jaffle|finance] [--dbt <abs path>] [--out <dir>] [--root <project dir>]
//     [--static-analysis baseline|strict]
// The dbt executable comes from --dbt or DBT_BIN; PATH is not consulted. A jaffle target is a fresh copy prepared
// by `prep-jaffle.sh` unless --root is given. A finance target is a copy of finance_general (default
// /tmp/lsp-fin/finance_general) with profiles from ~/.dbt; run it from the environment that holds the credentials.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import YAML from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, "../../..");
const spike = path.join(repo, "scripts/spikes/lsp-capabilities");
const rpc = createRequire(import.meta.url)("vscode-jsonrpc/node");
export const scratch = "/tmp/fpu-adoption";

function fail(message) {
  console.error(message);
  process.exit(2);
}

/** Copies the jaffle fixture to `dest` and builds it with `dbt`. */
export function prepareJaffle(dest, dbt) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const run = spawnSync("sh", [path.join(spike, "prep-jaffle.sh"), dest], {
    env: { ...process.env, DBT_BIN: dbt },
    encoding: "utf8",
  });
  if (run.status !== 0)
    fail(`prep-jaffle.sh failed:\n${run.stdout}${run.stderr}`);
  return fs.realpathSync(dest);
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const typeOf = (v) => (v === null ? "null" : typeof v);

/** Warehouse names (account, user, role, database, warehouse, schema) from non-DuckDB outputs and SNOWFLAKE_* env. */
function warehouseNames(root, profilesDir) {
  const names = new Set();
  for (const [key, value] of Object.entries(process.env)) {
    if (
      /^SNOWFLAKE_/.test(key) &&
      value &&
      value.length >= 3 &&
      !/^(true|false|\d+)$/i.test(value)
    )
      names.add(value);
  }
  const project = YAML.parse(
    fs.readFileSync(path.join(root, "dbt_project.yml"), "utf8"),
  );
  const profilesFile = path.join(profilesDir, "profiles.yml");
  if (!fs.existsSync(profilesFile)) return names;
  const profile = YAML.parse(fs.readFileSync(profilesFile, "utf8"))?.[
    project.profile
  ];
  for (const output of Object.values(profile?.outputs ?? {})) {
    if (output.type === "duckdb") continue;
    for (const key of [
      "account",
      "user",
      "role",
      "database",
      "warehouse",
      "schema",
    ]) {
      const v = output[key];
      if (typeof v === "string" && v.length >= 3 && !v.includes("{{"))
        names.add(v);
    }
  }
  return names;
}

/**
 * Redacts paths and credential-like env values (the spike's redactor), warehouse names, `database`/`schema` values
 * and `dbt.show` rows (each value becomes its JSON type).
 */
function makeRedactor(lib, root, profilesDir, warehouse) {
  const base = lib.redactor(root);
  const names = warehouse
    ? [...warehouseNames(root, profilesDir)].sort((a, b) => b.length - a.length)
    : [];
  const patterns = names.map((n) => new RegExp(escapeRegExp(n), "gi"));
  const threePart =
    /"?\b[A-Z][A-Z0-9_$]*"?\."?[A-Z][A-Z0-9_$]*"?\."?[A-Z][A-Z0-9_$]*\b"?/g;
  const scrub = (v) => {
    if (Array.isArray(v)) return v.map(scrub);
    if (v && typeof v === "object") {
      const out = {};
      for (const [k, x] of Object.entries(v)) {
        if ((k === "database" || k === "schema") && typeof x === "string")
          out[k] = "<redacted>";
        else if (
          k === "data" &&
          Array.isArray(x) &&
          x.every((r) => r && typeof r === "object")
        ) {
          out[k] = x.map((r) =>
            Object.fromEntries(
              Object.entries(r).map(([c, y]) => [c, `<${typeOf(y)}>`]),
            ),
          );
        } else out[k] = scrub(x);
      }
      return out;
    }
    if (typeof v !== "string" || !warehouse) return v;
    let s = v;
    for (const p of patterns) s = s.replace(p, "<warehouse-name>");
    return s.replace(threePart, "<db>.<schema>.<relation>");
  };
  return (v) => scrub(base(v));
}

/** Parses arguments, prepares the target and imports the spike harness with DBT_BIN set. */
export async function setup(
  experiment,
  { targets = ["jaffle", "finance"], prepare } = {},
) {
  const { values } = parseArgs({
    options: {
      target: { type: "string", default: targets[0] },
      dbt: { type: "string" },
      out: { type: "string" },
      root: { type: "string" },
      "static-analysis": { type: "string" },
    },
  });
  const dbt = values.dbt ?? process.env.DBT_BIN;
  if (!dbt || !path.isAbsolute(dbt) || !fs.existsSync(dbt))
    fail("set --dbt or DBT_BIN to an absolute dbt path");
  if (!targets.includes(values.target))
    fail(`${experiment} supports --target ${targets.join("|")}`);
  // lib.mjs reads DBT_BIN when it is imported.
  process.env.DBT_BIN = dbt;
  const lib = await import(pathToFileURL(path.join(spike, "lib.mjs")).href);
  const { configs } = await import(
    pathToFileURL(path.join(spike, "configs.mjs")).href
  );
  const target = values.target;
  const finance = target === "finance";
  let root;
  if (values.root) root = fs.realpathSync(values.root);
  else if (finance) root = fs.realpathSync("/tmp/lsp-fin/finance_general");
  else if (target === "jaffle")
    root = prepareJaffle(path.join(scratch, `${experiment}-jaffle`), dbt);
  if (prepare && root) prepare(root, target);
  const profilesDir = finance ? path.join(os.homedir(), ".dbt") : root;
  const config = configs[target];
  const mode = values["static-analysis"];
  const lspArgs = mode
    ? ["--static-analysis", mode]
    : (config?.lspArgs ?? ["--static-analysis", "strict"]);
  const redact = root
    ? makeRedactor(lib, root, profilesDir, finance)
    : (v) => v;
  const dbtVersion = spawnSync(dbt, ["--version"], {
    encoding: "utf8",
  }).stdout.split("\n")[0];
  const out = path.resolve(values.out ?? scratch);
  const projectName = root
    ? YAML.parse(fs.readFileSync(path.join(root, "dbt_project.yml"), "utf8"))
        .name
    : undefined;

  const start = (opts = {}) =>
    lib.startServer({ root, profilesDir, extraArgs: lspArgs, ...opts });
  /** Opens `rel` and resolves after the first background full compile, or with {timeout}. */
  const load = async (server, rel, timeoutMs = 600000) => {
    server.openDoc(path.join(root, rel));
    return server.waitNotification("dbt/lspBackgroundCompileComplete", {
      timeoutMs,
    });
  };
  const write = (result) => {
    const file = path.join(
      out,
      `${experiment}-${target}${mode ? `-${mode}` : ""}.json`,
    );
    lib.writeJson(
      file,
      redact({
        experiment,
        target,
        dbtVersion,
        date: new Date().toISOString(),
        ...result,
      }),
    );
    return file;
  };
  const decide = (text) =>
    console.log(`DECISION ${experiment} (${target}): ${text}`);
  return {
    lib,
    dbt,
    target,
    finance,
    root,
    profilesDir,
    config,
    lspArgs,
    projectName,
    start,
    load,
    write,
    decide,
  };
}

export const p50 = (values) => percentileOf(values, 50);
export const p95 = (values) => percentileOf(values, 95);
function percentileOf(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
    : null;
}

/**
 * Sends `workspace/executeCommand` with its own cancellation token: `cancel()` sends `$/cancelRequest`.
 * `done` resolves with {result} or {error} plus `ms` and the time of the answer relative to `t0`; it never rejects.
 */
export function cancellable(server, command, args) {
  const source = new rpc.CancellationTokenSource();
  const t0 = Date.now();
  const done = server.conn
    .sendRequest(
      "workspace/executeCommand",
      { command, arguments: args },
      source.token,
    )
    .then(
      (result) => ({ result }),
      (error) => ({ error: { code: error.code, message: error.message } }),
    )
    .then((r) => ({ ...r, ms: Date.now() - t0 }));
  return { done, cancel: () => source.cancel(), t0 };
}

/** Same digest as `projectRootDigest`, so prefixes match what the extension sends. */
export const rootDigest = (fsPath) =>
  crypto.createHash("sha256").update(fsPath).digest("base64url").slice(0, 12);

/** Nodes, ids and `depends_on` edges of a `dbt.listNodes` result. */
export function graphOf(result) {
  const nodes = result?.nodes ?? [];
  const ids = new Set(nodes.map((n) => n.unique_id));
  const edges = nodes.flatMap((n) =>
    (n.depends_on?.nodes ?? []).map((p) => `${p} -> ${n.unique_id}`),
  );
  const byType = {};
  for (const n of nodes)
    byType[n.resource_type] = (byType[n.resource_type] ?? 0) + 1;
  return { nodes, ids, edges, byType };
}
