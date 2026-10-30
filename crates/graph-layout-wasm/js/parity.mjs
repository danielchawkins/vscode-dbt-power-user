import { readFileSync } from "node:fs";
// Parity check (`just crates::parity`): the native Node-API build and the WebAssembly build must return, for the golden
// graph frame, the bytes of the empty-layout frame in the fixture. Usage: node parity.mjs <dist dir> [fixture file].
// Exits 1 on any difference.
import { createRequire } from "node:module";
import path from "node:path";
import { loadWasm } from "./index.mjs";

const dir = path.resolve(process.argv[2] ?? "../dist/graph-layout");
const fixture = path.resolve(
  process.argv[3] ??
    path.join(
      import.meta.dirname,
      "../../graph-layout/fixtures/parity/frame.txt",
    ),
);
const native = createRequire(import.meta.url)(
  path.join(dir, "graph_layout_napi.node"),
);
const wasm = loadWasm(dir);

// The fixture holds one line per frame: `frame <kind> <hex>`.
function frameOf(text, kind) {
  const prefix = `frame ${kind} `;
  const line = text.split("\n").find((row) => row.startsWith(prefix));
  if (line === undefined) {
    throw new Error(`parity: the fixture holds no frame ${kind}`);
  }
  return Buffer.from(line.slice(prefix.length), "hex");
}

const text = readFileSync(fixture, "utf8");
const graph = frameOf(text, "graph");
const expected = frameOf(text, "empty-layout").toString("hex");
const outputs = {
  native: Buffer.from(native.layout(graph)).toString("hex"),
  wasm: Buffer.from(wasm.layout(graph)).toString("hex"),
};

let failed = false;
for (const [name, hex] of Object.entries(outputs)) {
  if (hex !== expected) {
    failed = true;
    console.error(`parity: ${name} returned ${hex}, golden is ${expected}`);
  }
}
if (failed) {
  process.exit(1);
}
console.log(
  `parity: native and wasm match the empty layout in ${path.relative(process.cwd(), fixture)}`,
);
