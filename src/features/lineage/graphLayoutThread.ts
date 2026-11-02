/**
 * The Worker thread behind the lineage panel's Rust layout (graphLayoutWorker.ts is the host's side). It loads the WASM
 * binding that `just crates::wasm` wrote into `dist/graph-layout`, and keeps one `LayoutEngine` handle per session, so a
 * panel's relayouts reuse its cache. It answers each message in order; a message that throws answers with its error.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import type { WorkerReply, WorkerRequest } from "./graphLayoutWorker";

/** The parts of the wasm-bindgen nodejs glue this thread uses. */
interface Handle {
  layout(
    frame: Uint8Array,
    options: Uint8Array,
    generation: bigint,
  ): Uint8Array | undefined;
  free(): void;
}

interface Binding {
  LayoutEngine: new () => Handle;
}

const { dir } = workerData as { dir: string };
// The glue is CommonJS and sits beside its package.json, which marks the folder as CommonJS.
const binding = createRequire(path.join(dir, "package.json"))(
  "./graph_layout_wasm.js",
) as Binding;
const handles = new Map<number, Handle>();

// A Worker-thread message, not a webview one: it reaches only this extension's own Worker.
// eslint-disable-next-line no-restricted-syntax -- the host's channel to its own Worker, not a webview
const answer = (message: WorkerReply) => parentPort?.postMessage(message);

parentPort?.on("message", (request: WorkerRequest) => {
  if (request.kind === "release") {
    handles.get(request.session)?.free();
    handles.delete(request.session);
    return;
  }
  try {
    let handle = handles.get(request.session);
    if (!handle) {
      handle = new binding.LayoutEngine();
      handles.set(request.session, handle);
    }
    const frame = handle.layout(
      request.frame,
      Buffer.from(request.options),
      BigInt(request.generation),
    );
    answer({ id: request.id, frame });
  } catch (error) {
    answer({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
