// JavaScript wrapper for the WebAssembly binding. `just crates::wasm` writes the wasm-bindgen nodejs glue into dist/;
// this file loads it, so callers never reach into the build output.
import { createRequire } from "node:module";
import path from "node:path";

/** Loads the wasm-bindgen nodejs glue (`graph_layout_wasm.js`) that `just crates::wasm` wrote into `dir`. */
export function loadWasm(dir) {
  return createRequire(import.meta.url)(path.join(dir, "graph_layout_wasm.js"));
}
