// E1, graph selector. Decision rule (fixed before running): try ["package:<root>"], ["+package:<root>"] and their
// union. Choose the smallest that contains every `depends_on` target; otherwise draw the missing package nodes as
// placeholders labelled with their unique_id (2.4 stops if more than 5% of edges end at placeholders). Records the
// resource types present, which fill the server-owned resource types in FIELD_OWNERS. The jaffle copy gains a
// snapshot, which the spike fixtures lacked.
import fs from "node:fs";
import path from "node:path";
import { graphOf, setup } from "./adoption.mjs";

const addSnapshot = (root, target) => {
  if (target !== "jaffle") return;
  fs.mkdirSync(path.join(root, "snapshots"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "snapshots/orders_snapshot.sql"),
    "{% snapshot orders_snapshot %}\n{{ config(unique_key='order_id', strategy='check', check_cols='all') }}\n" +
      "select * from {{ ref('orders') }}\n{% endsnapshot %}\n",
  );
};

const ctx = await setup("e1-graph-selector", { prepare: addSnapshot });
const server = await ctx.start();
const loaded = await ctx.load(server, ctx.config.files.model);
const pkg = `package:${ctx.projectName}`;
const candidates = {
  package: [pkg],
  plusPackage: [`+${pkg}`],
  union: [pkg, `+${pkg}`],
};
const rows = {};
for (const [label, selectors] of Object.entries(candidates)) {
  const e = await server.exec("dbt.listNodes", selectors, {
    timeoutMs: 300000,
  });
  const g = graphOf(e.result);
  const targets = g.nodes.flatMap((n) => n.depends_on?.nodes ?? []);
  const missing = [...new Set(targets.filter((t) => !g.ids.has(t)))].sort();
  const missingEdges = targets.filter((t) => !g.ids.has(t)).length;
  rows[label] = {
    selectors,
    ms: e.ms,
    error: e.error ?? e.result?.error ?? null,
    nodes: g.nodes.length,
    edges: targets.length,
    byType: g.byType,
    packages: [...new Set(g.nodes.map((n) => n.package_name))].sort(),
    missingTargets: missing.length,
    missingSample: missing.slice(0, 20),
    missingByPrefix: missing.reduce(
      (a, t) => ((a[t.split(".")[0]] = (a[t.split(".")[0]] ?? 0) + 1), a),
      {},
    ),
    placeholderEdgeShare: targets.length ? missingEdges / targets.length : 0,
  };
}
await server.stop();

const complete = Object.entries(rows)
  .filter(([, r]) => !r.error && r.missingTargets === 0)
  .sort((a, b) => a[1].nodes - b[1].nodes);
const chosen = complete[0]?.[0] ?? "package";
const resourceTypes = Object.keys(rows[chosen].byType).sort();
const decision = complete.length
  ? `selector ${JSON.stringify(rows[chosen].selectors)} (${rows[chosen].nodes} nodes) contains every depends_on target`
  : `no candidate is complete; ["${pkg}"] with ${rows.package.missingTargets} placeholder nodes ` +
    `(${(rows.package.placeholderEdgeShare * 100).toFixed(2)}% of edges)`;
const file = ctx.write({
  rule: "smallest complete candidate; else package:<root> with placeholders",
  loadMs: loaded.t ?? null,
  candidates: rows,
  chosen,
  resourceTypes,
  decision,
});
ctx.decide(
  `${decision}; resource types ${resourceTypes.join(", ")} -> ${file}`,
);
process.exit(0);
