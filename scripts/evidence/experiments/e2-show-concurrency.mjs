// E2, `dbt.show` concurrency and cancellation. Decision rule (fixed before running): run a long `show` against
// `listNodes` and against `compileFile`. Each command class gets its own queue; a pair interferes (and its two classes
// share one queue) when the second request answers more than 1 s later than its solo p50, answers only after the show
// finishes, or either request errors or is cancelled. Then send `$/cancelRequest` during a long query: if the
// warehouse query does not stop, the UI drops the result and says the query may still run. The warehouse half reads
// Snowflake query history on finance; where history cannot be read it is "not established". On jaffle the local half
// samples the server's CPU after the cancel. 2.8 stops if one `show` blocks lineage for longer than 2 s.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { cancellable, p50, setup } from "./adoption.mjs";

const ctx = await setup("e2-show-concurrency");
const { lib, root, finance } = ctx;
const server = await ctx.start();
await ctx.load(server, ctx.config.files.model);
await lib.sleep(1000);
const modelUri = lib.fileUri(`${root}/${ctx.config.files.model}`);
const lineageSelector = finance ? [`+${ctx.config.uniqueId}+`] : ["+orders+"];
const nonce = crypto.randomBytes(4).toString("hex");
const longSql = (seconds, tag) =>
  finance
    ? `select count(*) as n, 'fpu_e2_${tag}_${nonce}' as marker from table(generator(timelimit => ${seconds}))`
    : `select sum(a.range * b.range) as n, 'fpu_e2_${tag}' as marker from range(${seconds * 20000}) a, range(100000) b`;
const show = (inline) =>
  cancellable(server, "dbt.show", [{ inline, limit: 1 }]);
const classes = {
  listNodes: () => cancellable(server, "dbt.listNodes", lineageSelector),
  compileFile: () => cancellable(server, "dbt.compileFile", [modelUri]),
};

const solo = {};
for (const [name, call] of Object.entries(classes)) {
  const ms = [];
  for (let i = 0; i < 5; i++) ms.push((await call().done).ms);
  solo[name] = { samples: ms, p50: p50(ms) };
}
const longSolo = await show(longSql(10, "solo")).done;
solo.longShow = {
  ms: longSolo.ms,
  error: longSolo.error ?? longSolo.result?.error ?? null,
};

const failed = (r) => Boolean(r.error || r.result?.error);
const pairs = {};
for (const [name, call] of Object.entries(classes)) {
  const long = show(longSql(10, name));
  await lib.sleep(1000);
  const other = call();
  const [o, s] = await Promise.all([other.done, long.done]);
  const otherAt = other.t0 + o.ms;
  const showAt = long.t0 + s.ms;
  const interferes =
    o.ms > solo[name].p50 + 1000 ||
    (otherAt >= showAt && s.ms > 2000) ||
    failed(o) ||
    failed(s);
  pairs[`show+${name}`] = {
    otherMs: o.ms,
    otherSoloP50: solo[name].p50,
    showMs: s.ms,
    otherAnsweredBeforeShow: otherAt < showAt,
    otherError: o.error ?? o.result?.error ?? null,
    showError: s.error ?? s.result?.error ?? null,
    interferes,
  };
}

const cpuOf = (pid) =>
  Number(
    spawnSync("ps", ["-o", "%cpu=", "-p", String(pid)], {
      encoding: "utf8",
    }).stdout.trim(),
  );
const cancelRun = show(longSql(finance ? 60 : 30, "cancel"));
await lib.sleep(3000);
const cpuBefore = cpuOf(server.child.pid);
cancelRun.cancel();
const cancelSentAt = Date.now() - cancelRun.t0;
const cancelled = await Promise.race([
  cancelRun.done,
  lib.sleep(90000).then(() => ({ timeout: 90000 })),
]);
const cpuAfter = [];
for (let i = 0; i < 5; i++) {
  cpuAfter.push(cpuOf(server.child.pid));
  await lib.sleep(1000);
}
const cancellation = {
  cancelSentAtMs: cancelSentAt,
  answeredAtMs: cancelled.ms ?? null,
  answeredEarly:
    cancelled.ms !== undefined && cancelled.ms < cancelSentAt + 5000,
  response: cancelled.error ?? cancelled.result ?? cancelled,
  serverCpuBeforeCancel: cpuBefore,
  serverCpuAfterCancel: cpuAfter,
};

let warehouse = {
  established: false,
  reason: "jaffle runs DuckDB in process; no warehouse query history",
};
if (finance) {
  await lib.sleep(10000);
  const history = await show(
    "select execution_status, error_message, datediff('millisecond', start_time, coalesce(end_time, " +
      "current_timestamp())) as elapsed_ms from table(information_schema.query_history(result_limit => 1000)) " +
      `where query_text ilike '%fpu_e2_cancel_${nonce}%' and query_text not ilike '%query_history%'`,
  ).done;
  const rows = history.result?.data ?? [];
  const status = rows.map((r) => r.execution_status ?? r.EXECUTION_STATUS);
  if (failed(history) || rows.length === 0) {
    warehouse = {
      established: false,
      reason: "query history unreadable or empty",
      error: history.error ?? history.result?.error ?? null,
    };
  } else {
    // Rows are kept: statuses and timings are not warehouse data.
    warehouse = {
      established: true,
      rows: rows.map((r) => ({
        status: r.execution_status ?? r.EXECUTION_STATUS,
        error: r.error_message ?? r.ERROR_MESSAGE ?? null,
        elapsedMs: Number(r.elapsed_ms ?? r.ELAPSED_MS),
      })),
      stopped: status.every((x) => x !== "RUNNING" && x !== "SUCCESS"),
    };
  }
}
await server.stop();

const shared = Object.entries(pairs)
  .filter(([, p]) => p.interferes)
  .map(([k]) => k);
const queues = shared.length
  ? `shared queue for ${shared.join(", ")}`
  : "own queue per command class";
const cancelDecision = warehouse.established
  ? warehouse.stopped
    ? "cancel stops the warehouse query"
    : "cancel does not stop the warehouse query: the UI drops the result and says the query may still run"
  : `warehouse cancel not established (${warehouse.reason})`;
const lineageBlockedMs = pairs["show+listNodes"].otherMs;
const file = ctx.write({
  rule: "interferes when other > solo p50 + 1 s, answers after the show, or either errors; cancel by query history",
  solo,
  pairs,
  cancellation,
  warehouse,
  decision: {
    queues,
    cancel: cancelDecision,
    lineageBlockedMs,
    stop: lineageBlockedMs > 2000,
  },
});
ctx.decide(
  `${queues}; server answered cancel early: ${cancellation.answeredEarly}; ${cancelDecision}; ` +
    `lineage blocked ${lineageBlockedMs} ms${lineageBlockedMs > 2000 ? " (STOP: above 2 s)" : ""} -> ${file}`,
);
process.exit(0);
