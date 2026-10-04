// E8, baseline mode. Decision rule (fixed before running): `dbt.listNodes ["package:<root>"]` in `baseline` passes if
// it returns every model node and every `depends_on` edge that `strict` returns on the same project; otherwise
// FIELD_OWNERS assigns the graph fields to the parse producer for `baseline` projects and 2.6 keeps the parse graph
// parsers. Also records the listNodes grain, the code lenses on the CTE model, and the latency of a column fetch
// (`getCurrentNode`, falling back to `dbt.show` introspection when it has no columns) in `baseline` against `strict`
// (five models, five samples each). A baseline column p50 above 3 s on finance is the stop in Risks.
import path from "node:path";
import { graphOf, p50, setup } from "./adoption.mjs";

const ctx = await setup("e8-baseline-mode");
const { lib, root, config, projectName } = ctx;
const runMode = async (mode) => {
  const server = await ctx.start({ extraArgs: ["--static-analysis", mode] });
  const loaded = await ctx.load(server, config.files.cteModel);
  await lib.sleep(1000);
  const e = await server.exec("dbt.listNodes", [`package:${projectName}`], {
    timeoutMs: 300000,
  });
  const g = graphOf(e.result);
  const models = g.nodes.filter((n) => n.resource_type === "model");
  const lenses = await server.request("textDocument/codeLens", {
    textDocument: { uri: lib.fileUri(path.join(root, config.files.cteModel)) },
  });
  const sample = [
    config.files.model,
    ...config.files.currentNodeAlso.filter((f) => f.endsWith(".sql")),
  ]
    .concat(models.map((m) => m.original_file_path))
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 5);
  const columnMs = [];
  const columnCounts = {};
  const fallbackUsed = {};
  const nameOf = (rel) =>
    models.find((m) => m.original_file_path === rel)?.name ??
    path.basename(rel, ".sql");
  // 2.10's path: getCurrentNode columns, else `dbt.show` over adapter.get_columns_in_relation.
  const introspect = (name) =>
    `{% set cols = adapter.get_columns_in_relation(ref('${name}')) %}select {% for c in cols %}` +
    "'{{ c.name }}:{{ c.dtype }}' as c{{ loop.index }}{{ ',' if not loop.last }}{% endfor %}";
  for (const rel of sample) {
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      const c = await server.exec("dbt.getCurrentNode", [rel], {
        timeoutMs: 120000,
      });
      let count = Object.keys(c.result?.node?.columns ?? {}).length;
      if (count === 0) {
        const s = await server.exec(
          "dbt.show",
          [{ inline: introspect(nameOf(rel)), limit: 1 }],
          { timeoutMs: 120000 },
        );
        count = s.result?.columns?.length ?? 0;
        fallbackUsed[rel] = s.result?.error ?? true;
      }
      columnMs.push(Date.now() - t0);
      columnCounts[rel] = count;
    }
  }
  await server.stop();
  return {
    loadMs: loaded.t ?? null,
    grain: e.result?.grain ?? null,
    error: e.result?.error ?? e.error ?? null,
    nodes: g.nodes.length,
    byType: g.byType,
    modelIds: models.map((m) => m.unique_id).sort(),
    edges: g.edges.sort(),
    lensCount: lenses.result?.length ?? 0,
    lensCommands: [
      ...new Set((lenses.result ?? []).map((l) => l.command?.command)),
    ],
    columnSample: sample,
    columnCounts,
    fallbackUsed,
    columnMs,
    columnP50: p50(columnMs),
  };
};

const strict = await runMode("strict");
const baseline = await runMode("baseline");
const baseModels = new Set(baseline.modelIds);
const baseEdges = new Set(baseline.edges);
const missingModels = strict.modelIds.filter((id) => !baseModels.has(id));
const missingEdges = strict.edges.filter((e) => !baseEdges.has(e));
const passes =
  missingModels.length === 0 && missingEdges.length === 0 && !baseline.error;
const stop = ctx.finance && baseline.columnP50 > 3000;
const decision = passes
  ? "passes: baseline listNodes returns every strict model and edge; graph fields stay server-owned in baseline"
  : `fails (${missingModels.length} models, ${missingEdges.length} edges missing): baseline graph fields stay ` +
    "parse-owned and 2.6 keeps the parse graph parsers";
const summary = (r) => ({
  ...r,
  modelIds: r.modelIds.length,
  edges: r.edges.length,
});
const file = ctx.write({
  rule: "see header",
  strict: summary(strict),
  baseline: summary(baseline),
  missingModels,
  missingEdges: missingEdges.slice(0, 50),
  missingEdgeCount: missingEdges.length,
  stop,
  decision,
});
ctx.decide(
  `${decision}; column p50 strict ${strict.columnP50} ms, baseline ${baseline.columnP50} ms` +
    `${stop ? " (STOP: above 3 s)" : ""} -> ${file}`,
);
process.exit(0);
