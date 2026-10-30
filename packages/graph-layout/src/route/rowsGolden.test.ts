import fc from "fast-check";
import { expect, it } from "vitest";
import { clusteredGraphArb, options } from "../testing/graphs.js";
import { routeGraph } from "../testing/routeGraphs.js";
import type { Routing } from "./index.js";

// Golden: the routed output of rows layouts (the default `ranks`) on seeded clustered graphs, as one fingerprint. Any
// change to rows output changes it, so a refactor that is meant to keep rows must keep this value. The value is FNV-1a
// over the JSON text below; a deliberate change to rows output updates it.

const ROWS_FINGERPRINT = "2e9f2de7";

function sorted<T>(map: ReadonlyMap<string, T>): [string, T][] {
  return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function dump(result: Routing) {
  return {
    nodes: sorted(result.nodes),
    edges: sorted(result.edges),
    clusters: sorted(result.clusters),
  };
}

/** FNV-1a, 32 bits, over the UTF-16 code units of `text`. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

it("keeps rows output byte-identical on seeded clustered graphs", () => {
  const graphs = fc.sample(clusteredGraphArb, { seed: 20260, numRuns: 80 });
  const cases: unknown[] = [];
  for (const graph of graphs) {
    for (const direction of ["down", "right"] as const) {
      for (const effort of ["fast", "balanced"] as const) {
        const result = routeGraph(graph, { ...options, direction, effort });
        cases.push({ direction, effort, result: dump(result) });
      }
    }
  }
  const text = JSON.stringify(cases);
  expect(fingerprint(text)).toBe(ROWS_FINGERPRINT);
}, 120_000);
