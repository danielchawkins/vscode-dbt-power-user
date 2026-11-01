// JavaScript wrapper for the bindings. `just crates::wasm` writes the wasm-bindgen nodejs glue into dist/, and
// `just crates::napi` copies the Node-API addon there; this file loads them, so callers never reach into the build output.
// Options are sent as the UTF-8 JSON of the object. A refusal throws an Error whose `code` is `frame`, `options`,
// `generation`, `input` or `phases` (ADR 0011, Decision 6).
import { createRequire } from "node:module";
import path from "node:path";

/** Loads the wasm-bindgen nodejs glue (`graph_layout_wasm.js`) that `just crates::wasm` wrote into `dir`. */
export function loadWasm(dir) {
  return createRequire(import.meta.url)(path.join(dir, "graph_layout_wasm.js"));
}

/** Loads the Node-API addon (`graph_layout_napi.node`) that `just crates::napi` copied into `dir`. */
export function loadNative(dir) {
  return createRequire(import.meta.url)(
    path.join(dir, "graph_layout_napi.node"),
  );
}

const encodeOptions = (options) => Buffer.from(JSON.stringify(options));

/** Lays out the graph frame `frame` with `options` by `binding` (from loadWasm or loadNative); returns the layout frame. */
export function layout(binding, frame, options = {}) {
  return binding.layout(frame, encodeOptions(options));
}

/**
 * The engine handle of `binding`. `layout(frame, options, generation)` returns the layout frame, or `undefined` once a
 * newer generation has started. The WASM binding takes the generation as a BigInt: pass `{ bigint: true }` for it.
 */
export class Engine {
  #handle;
  #bigint;

  constructor(binding, { bigint = false } = {}) {
    this.#handle = new binding.LayoutEngine();
    this.#bigint = bigint;
  }

  layout(frame, options = {}, generation = 0) {
    const id = this.#bigint ? BigInt(generation) : generation;
    // napi returns `null` for a superseded generation and wasm-bindgen returns `undefined`; the wrapper says `undefined`.
    return this.#handle.layout(frame, encodeOptions(options), id) ?? undefined;
  }
}
