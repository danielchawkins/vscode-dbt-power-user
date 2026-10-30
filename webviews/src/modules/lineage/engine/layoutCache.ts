/**
 * The panel's layouter: a layout result cached by the content of its request, and each layout seeded with the
 * result on screen. The cache is the webview-side mirror of the engine's own phase cache; Phase 7 subsumes it.
 */
import type { lineage } from "@fusion-power-user/webview-contract";
import { engineFor } from "./engines";
import type {
  LayoutEngine,
  LayoutRequest,
  LayoutResponse,
} from "./layoutEngine";

/** Lays out one request with the named engine. */
export type Layouter = (
  request: LayoutRequest,
  engine: lineage.LineageEngine,
) => LayoutResponse;

/** How many results the layouter keeps: the views a user flips between, not the whole session. */
const CAPACITY = 8;

/** Lays out every request afresh, with no cache and no hints. */
export const freshLayouter: Layouter = (request, engine) =>
  engineFor(engine).layout(request);

/** cyrb53: a 53-bit string hash, the same on every run, so a key means the same content in every session. */
function hashOf(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * The content key of a request: a hash of every field the engine reads, with the engine's name. The `previous` hints
 * are not part of it: they seed a layout, and a cached result is the one first computed for this content.
 */
const contentKey = (
  request: LayoutRequest,
  engine: lineage.LineageEngine,
): string =>
  hashOf(
    JSON.stringify([
      engine,
      request.focus,
      request.cards,
      request.edges,
      request.rankPairs,
      request.traceOn,
    ]),
  );

/**
 * A layouter that keeps the last `capacity` results, least recently used first to go, and seeds each layout with the
 * result on screen when it has the same start card: an expansion then moves the cards it had as little as it can.
 * `resolve` picks the engine; the default is the panel's engine table.
 */
export function createLayouter(
  resolve: (engine: lineage.LineageEngine) => LayoutEngine = engineFor,
  capacity = CAPACITY,
): Layouter {
  const results = new Map<string, LayoutResponse>();
  let shown: { focus: string; response: LayoutResponse } | undefined;
  return (request, engine) => {
    const key = contentKey(request, engine);
    let response = results.get(key);
    if (response) {
      results.delete(key);
    } else {
      const previous =
        shown?.focus === request.focus ? shown.response.hints : undefined;
      response = resolve(engine).layout({ ...request, previous });
    }
    results.set(key, response);
    const oldest = results.keys().next();
    if (results.size > capacity && !oldest.done) {
      results.delete(oldest.value);
    }
    shown = { focus: request.focus, response };
    return response;
  };
}
