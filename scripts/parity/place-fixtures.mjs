// The placement fixtures of `print-fixtures.mjs place` and `place-finance`: TypeScript's rows placement of each case, with
// the case's full placement input and TypeScript's outputs. The input is what `place` reads, written out and not derived
// from the order fixture: each layered node's rank, breadth, width, height, block, cluster chain and hint; each rank's
// order; each segment's ports and weight; each cluster spine; the cluster list; and the options (direction, effort as
// its iteration count, anchor, stability, spacing, seed). The outputs are the node points, the bounds (real node rectangles
// and cluster boxes), the placement edge length, the work count, and `exactSeparations` on one separation instance.
//
// The placement edge length is a placement-level measure, not the routed length of route (a later phase): the sum over
// the layered segments of the distance between their two port anchors, each anchor being its node's point moved by its
// port offset along the in-rank axis. The bounds are the union of the real node rectangles and the cluster boxes.
//
// `exactSeparations`: the exact projection of the Brandes and Köpf start onto the rank chain of the first 13 nodes of the
// widest rank (at most 12 separations, the bound of testing/exactSeparations.ts), with unit weights. The instance is
// written as x0, weight and separations, so the Rust check solves the same instance and compares bits.
//
// Contributor tooling only; it ships nothing. The caller registers the TypeScript resolve hook before importing this
// module, so the sources load after it.

import { readFileSync } from "node:fs";
import { financeGraph } from "./finance-graph.mjs";
import { bitsHex, LINEAGE_OPTIONS } from "./layering-graphs.mjs";

const { seededRandom } =
  await import("../../packages/graph-layout/src/random.ts");
const { clusteredGraphArb, options: graphOptions } =
  await import("../../packages/graph-layout/src/testing/graphs.ts");
const { exactSeparationOptimum } =
  await import("../../packages/graph-layout/src/testing/exactSeparations.ts");
const { directedBundles } =
  await import("../../packages/graph-layout/src/place/levelNodes.ts");

const EFFORTS = ["fast", "balanced"];
const DIRECTIONS = ["down", "right"];
// The default spacing of place/index.ts (DEFAULT_SPACING); a case's own spacing is merged over it.
const DEFAULT_SPACING = { node: 12, rank: 28, edge: 4, cluster: 12 };
const EXACT_NODES = 13;
const ROWS_SEED = 20260;
const ROWS_RUNS = 20;
const PACKAGE_CASES = 4;
const RANDOM_STRIDE = 20;

const bits = (x) => bitsHex(x);
const bitsCsv = (xs) => (xs.length > 0 ? xs.map(bits).join(",") : "-");
const orDash = (x) => (x === undefined ? "-" : String(x));

/**
 * Hints for a case: each layered node draws three values from `seededRandom(seed + 2000003)`, in node order, dummies
 * included: its order (`floor(u * 4)`), then its corner x and y in [-200, 200). Real nodes are keyed by id.
 */
function randomHints(seed, layered) {
  const random = seededRandom(seed + 2000003);
  const nodes = new Map();
  layered.nodes.forEach((node) => {
    const order = Math.floor(random() * 4);
    const x = random() * 400 - 200;
    const y = random() * 400 - 200;
    if (node.id !== undefined) {
      nodes.set(node.id, { rank: node.rank, order, x, y });
    }
  });
  return { nodes };
}

/** The separation projection's instance over the first `EXACT_NODES` nodes of the widest rank, or undefined. */
function exactInstance(layers, gapLeft, warm) {
  let widest;
  layers.forEach((layer) => {
    if (
      layer.length >= 2 &&
      (widest === undefined || layer.length > widest.length)
    ) {
      widest = layer;
    }
  });
  if (widest === undefined) {
    return undefined;
  }
  const nodes = widest.slice(0, EXACT_NODES);
  const x0 = nodes.map((i) => warm[i]);
  const weight = nodes.map(() => 1);
  const seps = nodes.slice(1).map((to, k) => ({
    from: k,
    to: k + 1,
    gap: gapLeft[to],
  }));
  const { x } = exactSeparationOptimum(x0, weight, seps);
  return { x0, weight, seps, optimum: x };
}

/** Runs the TypeScript pipeline on one case: rank, layer, order and place, with the case's hints when it has them. */
function runCase({ graph, options, seed, hinted, effort }, deps) {
  const {
    indexed,
    budgetOf,
    rank,
    layer,
    order,
    place,
    brandesKoepf,
    problemOf,
  } = deps;
  const base = { ...options, effort };
  const input = indexed(graph, base);
  const budget = budgetOf(base);
  const ranking = rank(input, base, budget);
  const layered = layer(input, base, ranking);
  const hints = hinted ? randomHints(seed, layered) : undefined;
  const withHints = {
    ...base,
    seed,
    ...(hints === undefined ? {} : { hints }),
  };
  const ordering = order(input, withHints, { ...ranking, layered });
  const placement = place(input, withHints, ordering);
  const spacing = { ...DEFAULT_SPACING, ...options.spacing };
  const problem = problemOf(ordering, withHints, spacing);
  const warm = brandesKoepf(problem);
  const exact = exactInstance(ordering.layers, problem.gapLeft, warm);
  // Which bundles the levels' across separations read: a plain function of the graph and the options, so it is stated.
  const directed = directedBundles(graph, layered, base);
  return {
    input,
    budget,
    layered,
    ordering,
    placement,
    spacing,
    withHints,
    exact,
    directed,
  };
}

/** The rectangles of the real nodes and the cluster boxes, in the drawing's frame. */
function rectsOf({ input, layered, placement, withHints }) {
  const down = withHints.direction === "down";
  const realNodes = new Map(input.nodes.map((n) => [n.id, n]));
  const rects = [];
  layered.nodes.forEach((node, i) => {
    if (node.id === undefined) {
      return;
    }
    const real = realNodes.get(node.id);
    const acrossExtent = down ? real.height : real.width;
    const p = placement.points[i];
    const halfAlong = node.breadth / 2;
    const halfAcross = acrossExtent / 2;
    rects.push(
      down
        ? {
            x: p.x - halfAlong,
            y: p.y - halfAcross,
            w: 2 * halfAlong,
            h: 2 * halfAcross,
          }
        : {
            x: p.x - halfAcross,
            y: p.y - halfAlong,
            w: 2 * halfAcross,
            h: 2 * halfAlong,
          },
    );
  });
  for (const rect of placement.clusters.values()) {
    rects.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
  }
  return rects;
}

/** The bounds of the rectangles as `minx,miny,maxx,maxy` IEEE bits, or `-` for none. */
function boundsLine(rects) {
  if (rects.length === 0) {
    return "-";
  }
  return [
    Math.min(...rects.map((r) => r.x)),
    Math.min(...rects.map((r) => r.y)),
    Math.max(...rects.map((r) => r.x + r.w)),
    Math.max(...rects.map((r) => r.y + r.h)),
  ]
    .map(bits)
    .join(",");
}

/** The placement edge length: each segment's port-to-port distance, summed in segment order. */
function edgeLength({ layered, placement, withHints }) {
  const down = withHints.direction === "down";
  const along = (p) => (down ? p.x : p.y);
  const across = (p) => (down ? p.y : p.x);
  let length = 0;
  for (const s of layered.segments) {
    const top = placement.points[s.top];
    const bottom = placement.points[s.bottom];
    const dx = along(bottom) + s.bottomOffset - (along(top) + s.topOffset);
    const dy = across(bottom) - across(top);
    length += Math.sqrt(dx * dx + dy * dy);
  }
  return length;
}

/** The case's header line: its name, effort, direction, sizes, budget, spacing, anchor, stability, hint and seed. */
function headerLine(name, run) {
  const { layered, budget, spacing, withHints } = run;
  const anchorId = withHints.anchor;
  const anchorFound =
    anchorId !== undefined &&
    layered.nodes.some((node) => node.id === anchorId);
  return [
    "case",
    `name=${name}`,
    `effort=${withHints.effort}`,
    `direction=${withHints.direction}`,
    `mode=${withHints.ranks}`,
    `ranks=${layered.ranks}`,
    `iterations=${budget.placeIterations}`,
    `spacing=${[spacing.node, spacing.edge, spacing.rank, spacing.cluster].map(bits).join(",")}`,
    `anchor=${anchorFound ? anchorId : "-"}`,
    `stability=${withHints.stability === undefined ? "-" : bits(withHints.stability)}`,
    `hinted=${withHints.hints === undefined ? 0 : 1}`,
    `seed=${withHints.seed}`,
  ].join(" ");
}

/** The cluster lines, one per cluster of the indexed graph, with its parent as an index. */
function clusterLines(clusters) {
  const clusterIndex = new Map(clusters.map((c, i) => [c.id, i]));
  return clusters.map((c, i) =>
    [
      "cluster",
      `index=${i}`,
      `id=${c.id}`,
      `parent=${c.parent === undefined ? "-" : clusterIndex.get(c.parent)}`,
      `padding=${c.padding === undefined ? "-" : bits(c.padding)}`,
      `label=${c.labelHeight === undefined ? "-" : bits(c.labelHeight)}`,
    ].join(" "),
  );
}

/** The layered node lines: rank, id, breadth, real size, block, anchoring, clusters and hint. */
function nodeLines({ input, layered, withHints }) {
  const realNodes = new Map(input.nodes.map((n) => [n.id, n]));
  return layered.nodes.map((node, i) => {
    const real = realNodes.get(node.id);
    const hint =
      node.id === undefined ? undefined : withHints.hints?.nodes.get(node.id);
    return [
      "node",
      `index=${i}`,
      `rank=${node.rank}`,
      `id=${orDash(node.id)}`,
      `breadth=${bits(node.breadth)}`,
      `width=${bits(real?.width ?? 0)}`,
      `height=${bits(real?.height ?? 0)}`,
      `block=${layered.block[i]}`,
      `anchored=${node.id !== undefined || node.port !== undefined ? 1 : 0}`,
      `path=${layered.paths[i]?.length ? layered.paths[i].join(",") : "-"}`,
      `hint=${hint === undefined ? "-" : `${bits(hint.x)},${bits(hint.y)}`}`,
    ].join(" ");
  });
}

/** The rank, segment and spine lines of the layered graph. */
function structureLines({ layered, ordering, directed }) {
  const lines = [];
  for (let r = 0; r < layered.ranks; r++) {
    const nodes = ordering.layers[r] ?? [];
    lines.push(`layer ${r} ${nodes.length > 0 ? nodes.join(",") : "-"}`);
  }
  layered.segments.forEach((s) => {
    lines.push(
      [
        "segment",
        `top=${s.top}`,
        `bottom=${s.bottom}`,
        `weight=${bits(s.weight)}`,
        `top_offset=${bits(s.topOffset)}`,
        `bottom_offset=${bits(s.bottomOffset)}`,
        `directed=${directed[s.bundle] ? 1 : 0}`,
      ].join(" "),
    );
  });
  layered.spines.forEach((spine) => lines.push(`spine ${spine.join(",")}`));
  return lines;
}

/** The `exact` line: the instance and its TypeScript optimum, or `exact -` for a case with no rank of two nodes. */
function exactLine(exact) {
  if (exact === undefined) {
    return "exact -";
  }
  return [
    "exact",
    `x0=${bitsCsv(exact.x0)}`,
    `weight=${bitsCsv(exact.weight)}`,
    `seps=${exact.seps.map((s) => `${s.from}>${s.to}@${bits(s.gap)}`).join(";")}`,
    `optimum=${bitsCsv(exact.optimum)}`,
  ].join(" ");
}

/** One case's lines: its `case` header, clusters, nodes, ranks, segments, spines, the exact instance and the outputs. */
function caseLines({ name, ...spec }, deps) {
  const run = runCase(spec, deps);
  const { placement, input } = run;
  const rects = rectsOf(run);
  const points = placement.points.map((p) => `${bits(p.x)},${bits(p.y)}`);
  return [
    headerLine(name, run),
    ...clusterLines(input.clusters ?? []),
    ...nodeLines(run),
    ...structureLines(run),
    exactLine(run.exact),
    `expect points=${points.join(";")} bounds=${boundsLine(rects)} edge_length=${bits(edgeLength(run))} work=${placement.work}`,
  ];
}

/** The graph's cases: the layering cases (package graphs and seeded random graphs) at each effort and direction. */
function layeringVariants(cases) {
  const variants = [];
  cases.forEach((c, k) => {
    for (const effort of EFFORTS) {
      for (const direction of DIRECTIONS) {
        variants.push({
          name: `${c.name}/${effort}/${direction}`,
          graph: c.graph,
          options: { ...c.options, ranks: "rows", direction },
          seed: k,
          hinted: k % 2 === 1,
          effort,
        });
      }
    }
  });
  return variants;
}

/** The seeded clustered graphs of rowsGolden, at each effort and direction. */
async function rowsVariants() {
  const fc = (await import("fast-check")).default;
  const graphs = fc.sample(clusteredGraphArb, {
    seed: ROWS_SEED,
    numRuns: ROWS_RUNS,
  });
  const variants = [];
  graphs.forEach((graph, k) => {
    for (const direction of DIRECTIONS) {
      for (const effort of EFFORTS) {
        variants.push({
          name: `rows-${k}/${effort}/${direction}`,
          graph,
          options: { ...graphOptions, ranks: "rows", direction },
          seed: 1000 + k,
          hinted: k % 2 === 0,
          effort,
        });
      }
    }
  });
  return variants;
}

/** The variant's anchor and stability, from its index, so the fixture covers the anchored and the free cases. */
function withVariations(variants) {
  return variants.map((v, i) => {
    const anchor = i % 3 === 0 ? v.graph.nodes?.[0]?.id : undefined;
    const options = { ...v.options };
    if (anchor !== undefined) {
      options.anchor = anchor;
    }
    if (i % 4 === 3) {
      options.stability = 0.5;
    }
    if (i % 5 === 4) {
      options.spacing = { node: 20, edge: 6, rank: 40, cluster: 16 };
    }
    return { ...v, options };
  });
}

const HEADER_LINES = (header) => [
  header,
  "# case name=<name> effort=<effort> direction=<down|right> mode=<rows|levels> ranks=<n> iterations=<n> spacing=<node,edge,rank,cluster IEEE bits> anchor=<id|-> stability=<bits|-> hinted=<0|1> seed=<n>: a placement's full input.",
  "# cluster index=<i> id=<id> parent=<index|-> padding=<bits|-> label=<bits|->; node index=<i> rank=<r> id=<id|-> breadth=<bits> width=<bits> height=<bits> block=<b> anchored=<0|1> path=<cluster indices|-> hint=<x,y bits|->: a layered node.",
  "# layer <rank> <nodes|->; segment top=<i> bottom=<j> weight=<bits> top_offset=<bits> bottom_offset=<bits> directed=<0|1>; spine <nodes>; exact x0=<bits> weight=<bits> seps=<from>><to>@<gap bits> optimum=<bits> (or exact -): exactSeparations on one instance.",
  "# expect points=<x,y bits per layered node>; bounds=<minx,miny,maxx,maxy bits|->; edge_length=<bits>; work=<n>: TypeScript's outputs of the placement.",
];

/** The placement fixture for the package and random layering cases and the rowsGolden graphs, in rows and levels mode. */
export async function printPlace(HEADER, layeringCases, deps) {
  // The four package graphs, then every `RANDOM_STRIDE`th seeded random graph: the fixture stays small enough to commit.
  const chosen = layeringCases.filter(
    (_, k) => k < PACKAGE_CASES || (k - PACKAGE_CASES) % RANDOM_STRIDE === 0,
  );
  const shapes = [...layeringVariants(chosen), ...(await rowsVariants())];
  // Each shape runs in both modes; a levels case is named `levels/...` so the two modes' names never collide.
  const variants = withVariations([
    ...shapes.map((v) => withRanks(v, "rows")),
    ...shapes.map((v) => withRanks(v, "levels")),
  ]);
  const lines = HEADER_LINES(HEADER);
  for (const v of variants) {
    lines.push(
      ...caseLines(
        {
          name: v.name,
          graph: v.graph,
          options: v.options,
          seed: v.seed,
          hinted: v.hinted,
          effort: v.effort,
        },
        deps,
      ),
    );
  }
  return lines;
}

/** The variant in the given ranks mode: `rows`, or `levels` under its own `levels/` name. */
function withRanks(variant, ranks) {
  const name = ranks === "rows" ? variant.name : `levels/${variant.name}`;
  return { ...variant, name, options: { ...variant.options, ranks } };
}

/** The placement of the finance lineage graph (the manifest is outside the repository, so it is not committed). */
export function printPlaceFinance(HEADER, manifestPath, deps) {
  if (manifestPath === undefined) {
    process.stderr.write(
      "usage: print-fixtures.mjs place-finance <manifest.json>\n",
    );
    process.exit(2);
  }
  const graph = financeGraph(JSON.parse(readFileSync(manifestPath, "utf8")));
  const lines = HEADER_LINES(HEADER);
  for (const ranks of ["rows", "levels"]) {
    for (const effort of EFFORTS) {
      const name =
        ranks === "rows" ? `finance/${effort}` : `levels/finance/${effort}`;
      lines.push(
        ...caseLines(
          {
            name,
            graph,
            options: { ...LINEAGE_OPTIONS, ranks, direction: "down" },
            seed: 7,
            hinted: false,
            effort,
          },
          deps,
        ),
      );
    }
  }
  return lines;
}
