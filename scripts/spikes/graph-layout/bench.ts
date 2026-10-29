// Spike, not production code: synthetic dbt-like graphs, timings and metrics for prototype.ts, the current owned
// layered pipeline (webviews/src/modules/lineage/layeredFlow.ts) on the same graphs, and a scripted-expansion
// stability run. Run it as README.md says; the numbers it printed are recorded there.
import { layout, rng, type Hints, type Options, type SEdge, type SNode } from "./prototype.ts";

const TAGS = ["source", "staging", "intermediate", "marts"];
const ROW = 22;
const HEADER = 44;
const WIDTH = 260;

export interface Synth {
  nodes: SNode[];
  edges: SEdge[];
  focus: string;
}

/** A dbt-shaped DAG: sources, staging, intermediate and marts, parents picked near the child's own position. */
export function synth(size: number, seed: number, variant: { columns: boolean; relationships: boolean }): Synth {
  const random = rng(seed);
  const share = [0.2, 0.3, 0.25, 0.25];
  const byPart: string[][] = [[], [], [], []];
  const nodes: SNode[] = [];
  const edges: SEdge[] = [];
  const rows = new Map<string, number>();
  for (let i = 0; i < size; i++) {
    const u = i / size;
    const part = u < share[0]! ? 0 : u < share[0]! + share[1]! ? 1 : u < 1 - share[3]! ? 2 : 3;
    const id = `${TAGS[part]}_${i}`;
    const columns = Math.max(2, Math.min(80, Math.round(Math.exp(Math.log(13) + 0.8 * gauss(random)))));
    const shown = variant.columns ? Math.min(columns, 25) : 0;
    rows.set(id, shown);
    const ports = [];
    for (let k = 0; k < shown; k++) {
      ports.push({ id: `i${k}`, side: "in" as const, offset: HEADER + ROW * k + ROW / 2 });
      ports.push({ id: `o${k}`, side: "out" as const, offset: HEADER + ROW * k + ROW / 2 });
    }
    nodes.push({ id, breadth: HEADER + 12 + ROW * shown, depth: WIDTH, partition: part, ports });
    byPart[part]!.push(id);
  }
  const pick = (pool: string[], near: number) => {
    const k = Math.round(near * (pool.length - 1) + (random() - 0.5) * Math.max(4, pool.length * 0.25));
    return pool[Math.max(0, Math.min(pool.length - 1, k))]!;
  };
  let edgeId = 0;
  for (let part = 1; part < 4; part++) {
    const own = byPart[part]!;
    own.forEach((id, k) => {
      const near = k / Math.max(1, own.length - 1);
      const count = part === 1 ? (random() < 0.15 ? 2 : 1) : 1 + Math.floor(random() * (part === 2 ? 3 : 4));
      const parents = new Set<string>();
      for (let c = 0; c < count; c++) {
        const roll = random();
        const pool =
          part === 1
            ? byPart[0]!
            : part === 2
              ? roll < 0.7 || k < 2
                ? byPart[1]!
                : own.slice(0, k)
              : roll < 0.6
                ? byPart[2]!
                : roll < 0.85 || k < 2
                  ? byPart[1]!
                  : own.slice(0, k);
        if (pool.length) parents.add(pick(pool, near));
      }
      for (const parent of parents) {
        edges.push({ id: `t${edgeId++}`, source: parent, target: id, kind: "dep" });
        if (variant.columns) {
          const columnEdges = 1 + Math.floor(random() * 4);
          for (let c = 0; c < columnEdges; c++) {
            const from = Math.floor(random() * Math.max(1, rows.get(parent)!));
            const to = Math.floor(random() * Math.max(1, rows.get(id)!));
            edges.push({
              id: `c${edgeId++}`,
              source: parent,
              target: id,
              sourcePort: `o${from}`,
              targetPort: `i${to}`,
              kind: "col",
            });
          }
        }
      }
    });
  }
  if (variant.relationships) {
    const pool = [...byPart[1]!, ...byPart[3]!];
    for (let r = 0; r < Math.round(size * 0.15); r++) {
      const a = pool[Math.floor(random() * pool.length)]!;
      const b = pool[Math.floor(random() * pool.length)]!;
      if (a !== b) edges.push({ id: `r${edgeId++}`, source: a, target: b, kind: "rel" });
    }
  }
  return { nodes, edges, focus: byPart[2]![Math.floor(byPart[2]!.length / 2)]! };
}

function gauss(random: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

export const OPTIONS: Options = {
  stability: 0,
  sweeps: 12,
  partitions: process.env.PARTITIONS !== "0",
  nodeGap: 28,
  edgeGap: 8,
  minChannel: 48,
};

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

function timeNew(graph: Synth, runs = 5) {
  const options = { ...OPTIONS, anchor: graph.focus };
  layout(graph.nodes, graph.edges, options);
  layout(graph.nodes, graph.edges, options);
  const results = Array.from({ length: runs }, () => layout(graph.nodes, graph.edges, options));
  const phases = (key: keyof (typeof results)[0]["ms"]) => Number(median(results.map((r) => r.ms[key])).toFixed(1));
  return {
    stats: results[0]!.stats,
    ms: { rank: phases("rank"), order: phases("order"), place: phases("place"), route: phases("route"), total: phases("total") },
  };
}

async function timeOld(graph: Synth, runs = 3) {
  // The bundled owned pipeline; scripts/spikes/graph-layout/README.md says how /tmp/layeredFlow.mjs is built.
  const { layeredFlow } = (await import("/tmp/graph-layout-spike/layeredFlow.mjs")) as {
    layeredFlow: (input: unknown) => { crossings: number; hops: number };
  };
  const tag = new Map(graph.nodes.map((n) => [n.id, TAGS[n.partition ?? 0]!]));
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const offset = (id: string, port: string | undefined) =>
    byId.get(id)!.ports?.find((p) => p.id === port)?.offset ?? HEADER / 2;
  const input = {
    start: graph.focus,
    nodes: graph.nodes.map((n) => ({ id: n.id, width: WIDTH, height: n.breadth, tag: tag.get(n.id)! })),
    tableRoutes: graph.edges.filter((e) => e.kind === "dep").map((e) => ({ id: e.id, parent: e.source, child: e.target })),
    columnRoutes: graph.edges
      .filter((e) => e.kind === "col")
      .map((e) => ({ id: e.id, from: e.source, fromOffset: offset(e.source, e.sourcePort), to: e.target, toOffset: offset(e.target, e.targetPort) })),
    relationshipRoutes: graph.edges.filter((e) => e.kind === "rel").map((e) => ({ id: e.id, from: e.source, to: e.target })),
    traceOn: false,
  };
  layeredFlow(input);
  const times: number[] = [];
  let out = { crossings: 0, hops: 0 };
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    out = layeredFlow(input);
    times.push(performance.now() - t);
  }
  return { ms: Number(median(times).toFixed(1)), crossings: out.crossings, hops: out.hops };
}

/** Expands a 1-hop neighbourhood of the focus `steps` times, laying out each step with and without hints. */
function stability(graph: Synth, steps: number, useHints: boolean, weight: number) {
  const random = rng(7);
  const neighbours = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (e.kind !== "dep") continue;
    (neighbours.get(e.source) ?? neighbours.set(e.source, new Set()).get(e.source)!).add(e.target);
    (neighbours.get(e.target) ?? neighbours.set(e.target, new Set()).get(e.target)!).add(e.source);
  }
  const shown = new Set([graph.focus, ...(neighbours.get(graph.focus) ?? [])]);
  let hints: Hints | undefined;
  let previous: ReturnType<typeof layout> | undefined;
  const rows: { nodes: number; ms: number; moved: number; flips: number; rankChanges: number }[] = [];
  for (let step = 0; step <= steps; step++) {
    if (step > 0) {
      const frontier = [...shown].filter((id) => [...(neighbours.get(id) ?? [])].some((m) => !shown.has(m)));
      const chosen = frontier[Math.floor(random() * frontier.length)];
      for (const m of neighbours.get(chosen ?? "") ?? []) shown.add(m);
    }
    const nodes = graph.nodes.filter((n) => shown.has(n.id));
    const edges = graph.edges.filter((e) => shown.has(e.source) && shown.has(e.target));
    const result = layout(nodes, edges, {
      ...OPTIONS,
      anchor: graph.focus,
      ...(useHints && hints ? { hints, stability: weight } : {}),
    });
    let moved = 0;
    let kept = 0;
    let flips = 0;
    let rankChanges = 0;
    if (previous) {
      const before = previous;
      const retained = [...before.centre.keys()].filter((id) => result.centre.has(id));
      // Relative to the focus card, which the panel keeps still while the view grows.
      const fa = before.centre.get(graph.focus)!;
      const fb = result.centre.get(graph.focus)!;
      const ra = before.rank.get(graph.focus)!;
      const rb = result.rank.get(graph.focus)!;
      for (const id of retained) {
        const a = before.centre.get(id)!;
        const b = result.centre.get(id)!;
        moved += Math.hypot(a.l - fa.l - (b.l - fb.l), a.p - fa.p - (b.p - fb.p));
        kept++;
        if (before.rank.get(id)! - ra !== result.rank.get(id)! - rb) rankChanges++;
      }
      for (let i = 0; i < retained.length; i++) {
        for (let j = i + 1; j < retained.length; j++) {
          const u = retained[i]!;
          const v = retained[j]!;
          if (before.rank.get(u) !== before.rank.get(v) || result.rank.get(u) !== result.rank.get(v)) continue;
          const was = before.centre.get(u)!.p < before.centre.get(v)!.p;
          const now = result.centre.get(u)!.p < result.centre.get(v)!.p;
          if (was !== now) flips++;
        }
      }
    }
    rows.push({ nodes: nodes.length, ms: Number(result.ms.total.toFixed(1)), moved: Math.round(kept ? moved / kept : 0), flips, rankChanges });
    hints = result.hints;
    previous = result;
  }
  return rows;
}

const sizes = (process.argv[2] ?? "50,150,300,600").split(",").map(Number);
const withOld = process.argv.includes("--old");
for (const size of sizes) {
  for (const variant of [
    { columns: false, relationships: false },
    { columns: false, relationships: true },
    { columns: true, relationships: true },
  ]) {
    const graph = synth(size, 42 + size, variant);
    const name = `${size}${variant.columns ? "+col" : ""}${variant.relationships ? "+rel" : ""}`;
    const fresh = timeNew(graph);
    const line: Record<string, unknown> = {
      graph: name,
      edges: graph.edges.length,
      ...fresh.ms,
      ...fresh.stats,
    };
    if (withOld && size <= 300) {
      const old = await timeOld(graph);
      line.oldMs = old.ms;
      line.oldCrossings = old.crossings;
      line.oldHops = old.hops;
    }
    console.log(JSON.stringify(line));
  }
}
if (process.argv.includes("--stability")) {
  const graph = synth(300, 342, { columns: false, relationships: true });
  const steps = 20;
  for (const [label, use, w] of [["no hints", false, 0], ["hints w=1", true, 1], ["hints w=10", true, 10]] as const) {
    const rows = stability(graph, steps, use, w);
    const sum = (k: "moved" | "flips" | "rankChanges") => rows.reduce((a, r) => a + r[k], 0);
    console.log(
      `stability, ${label}: final nodes ${rows.at(-1)!.nodes}, max ms ${Math.max(...rows.map((r) => r.ms))}, ` +
        `mean moved/step ${Math.round(sum("moved") / steps)}, order flips ${sum("flips")}, rank changes ${sum("rankChanges")}`,
    );
  }
}

/** The real max neighbourhood's shape (lineage-renderer-benchmark-october-2026.md): 5 tables, 7 table edges, 324 columns, 1,241 column edges. */
export function dense(seed: number): Synth {
  const random = rng(seed);
  const cols = [70, 60, 64, 66, 64];
  const nodes: SNode[] = cols.map((c, i) => ({
    id: `t${i}`,
    breadth: HEADER + 12 + ROW * c,
    depth: WIDTH,
    partition: Math.min(3, i),
    ports: Array.from({ length: c }, (_, k) => [
      { id: `i${k}`, side: "in" as const, offset: HEADER + ROW * k + ROW / 2 },
      { id: `o${k}`, side: "out" as const, offset: HEADER + ROW * k + ROW / 2 },
    ]).flat(),
  }));
  const pairs: [number, number][] = [[0, 1], [0, 2], [1, 2], [1, 3], [2, 3], [2, 4], [3, 4]];
  const edges: SEdge[] = pairs.map(([a, b], k) => ({ id: `d${k}`, source: `t${a}`, target: `t${b}`, kind: "dep" }));
  for (let k = 0; k < 1241; k++) {
    const [a, b] = pairs[k % pairs.length]!;
    // Mostly pass-through columns: a target column fed by a nearby source column.
    const from = Math.floor(random() * cols[a]!);
    const to = Math.max(0, Math.min(cols[b]! - 1, from + Math.round(gauss(random) * 6)));
    edges.push({ id: `c${k}`, source: `t${a}`, target: `t${b}`, sourcePort: `o${from}`, targetPort: `i${to}`, kind: "col" });
  }
  return { nodes, edges, focus: "t2" };
}
if (process.argv.includes("--dense")) {
  const graph = dense(5);
  const fresh = timeNew(graph);
  const old = await timeOld(graph, 1);
  console.log(JSON.stringify({ graph: "dense5", edges: graph.edges.length, ...fresh.ms, ...fresh.stats, oldMs: old.ms, oldCrossings: old.crossings, oldHops: old.hops }));
}
