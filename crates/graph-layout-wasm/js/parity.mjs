// Parity check (`just crates::parity`): the native Node-API build and the WebAssembly build must return the same bytes for
// the golden graph frame, through the one-shot `layout` and through the engine handle, and those bytes must equal the
// Rust golden layout. Both must also refuse a non-frame with the code `frame`. Usage: node parity.mjs <dist dir> [golden
// file]. Exits 1 on any difference.
import { readFileSync } from "node:fs";
import path from "node:path";
import { Engine, layout, loadNative, loadWasm } from "./index.mjs";

const dir = path.resolve(process.argv[2] ?? "../dist/graph-layout");
const fixtures = path.join(
  import.meta.dirname,
  "../../graph-layout/fixtures/parity",
);
const golden = path.resolve(
  process.argv[3] ?? path.join(fixtures, "golden-layout.txt"),
);
const bindings = { native: loadNative(dir), wasm: loadWasm(dir) };

// The fixtures hold one line per frame: `frame <kind> <hex>`.
function frameOf(text, kind) {
  const prefix = `frame ${kind} `;
  const line = text.split("\n").find((row) => row.startsWith(prefix));
  if (line === undefined) {
    throw new Error(`parity: the fixture holds no frame ${kind}`);
  }
  return Buffer.from(line.slice(prefix.length), "hex");
}

// The golden graph's two edge kinds need a policy to lay out.
const options = {
  edgeKinds: { lineage: { ranks: true }, ref: { ranks: false } },
};
const graph = frameOf(
  readFileSync(path.join(fixtures, "frame.txt"), "utf8"),
  "graph",
);
const expected = frameOf(readFileSync(golden, "utf8"), "layout");

const outputs = {};
const codes = {};
for (const [name, binding] of Object.entries(bindings)) {
  outputs[`${name} one-shot`] = Buffer.from(layout(binding, graph, options));
  const engine = new Engine(binding, { bigint: name === "wasm" });
  const handled = engine.layout(graph, options, 1);
  if (handled === undefined) {
    throw new Error(
      `parity: the ${name} handle returned nothing for generation 1`,
    );
  }
  outputs[`${name} handle`] = Buffer.from(handled);
  try {
    layout(binding, Buffer.from("not a frame"), options);
    codes[name] = "no error";
  } catch (error) {
    codes[name] = error.code;
  }
}

let failed = false;
for (const [name, bytes] of Object.entries(outputs)) {
  if (!bytes.equals(expected)) {
    failed = true;
    console.error(
      `parity: ${name} returned ${bytes.toString("hex")}, the golden layout is ${expected.toString("hex")}`,
    );
  }
}
for (const [name, code] of Object.entries(codes)) {
  if (code !== "frame") {
    failed = true;
    console.error(
      `parity: ${name} refused a non-frame with code ${code}, expected frame`,
    );
  }
}
if (failed) {
  process.exit(1);
}
console.log(
  `parity: native and wasm, one-shot and handle, return the golden layout (${expected.length} bytes); both refuse a non-frame with code frame`,
);
