import fs from "node:fs";
// Parity check (`just crates::parity`): the native Node-API build and the WebAssembly build must return the bytes in
// golden/layout.txt. Usage: node parity.mjs <dist dir> [golden file]. Exits 1 on any difference.
import { createRequire } from "node:module";
import path from "node:path";
import { loadWasm } from "./index.mjs";

const dir = path.resolve(process.argv[2] ?? "../dist/graph-layout");
const golden = path.resolve(
  process.argv[3] ?? path.join(import.meta.dirname, "golden/layout.txt"),
);
const native = createRequire(import.meta.url)(
  path.join(dir, "graph_layout_napi.node"),
);
const wasm = loadWasm(dir);

const expected = fs.readFileSync(golden, "utf8");
const outputs = {
  native: `${JSON.stringify({ layout: native.layout() })}\n`,
  wasm: `${JSON.stringify({ layout: wasm.layout() })}\n`,
};

let failed = false;
for (const [name, text] of Object.entries(outputs)) {
  if (text !== expected) {
    failed = true;
    console.error(
      `parity: ${name} returned ${text.trim()}, golden is ${expected.trim()}`,
    );
  }
}
if (failed) {
  process.exit(1);
}
console.log(
  `parity: native and wasm match ${path.relative(process.cwd(), golden)}`,
);
