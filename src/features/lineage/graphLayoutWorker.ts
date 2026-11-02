import { Worker } from "node:worker_threads";

/**
 * The host's side of the Rust layout (ADR 0011, Phase 8): one `worker_threads` Worker that runs the WASM binding, and
 * one session per lineage panel, each with its own `LayoutEngine` handle in the Worker. The Worker runs one layout at a
 * time, in the order they were sent, so a layout a newer generation of the same session overtakes is never run: it is
 * answered superseded, as is one a newer generation overtakes while it runs. The Worker starts on the first layout and
 * stops when this object is disposed.
 */

/** A message from the host to the Worker thread (graphLayoutThread.ts). */
export type WorkerRequest =
  | {
      kind: "layout";
      id: number;
      session: number;
      frame: Uint8Array;
      options: string;
      generation: number;
    }
  | { kind: "release"; session: number };

/** The Worker thread's answer to one layout: its frame, or no frame when a newer generation overtook it, or a refusal. */
export interface WorkerReply {
  id: number;
  frame?: Uint8Array | undefined;
  error?: string | undefined;
}

/** A panel's connection to the Worker: its layouts, and its release when the panel is disposed. */
export interface LayoutSession {
  /** Lays out `frame` with the JSON `options` for `generation`; resolves to the layout frame, or `undefined` if superseded. */
  layout(
    frame: Uint8Array,
    options: string,
    generation: number,
  ): Promise<Uint8Array | undefined>;
  /** Frees the session's engine handle in the Worker; its pending layouts resolve superseded. */
  dispose(): void;
}

export interface GraphLayoutWorkerPaths {
  /** The built Worker thread entry, `dist/graphLayoutThread.js`. */
  entry: string;
  /** The folder `just crates::wasm` wrote the WASM binding into, `dist/graph-layout`. */
  wasmDir: string;
}

interface Job {
  id: number;
  session: number;
  generation: number;
  frame: Uint8Array;
  options: string;
  resolve: (frame: Uint8Array | undefined) => void;
  reject: (error: Error) => void;
}

export class GraphLayoutWorker {
  readonly #paths: GraphLayoutWorkerPaths;
  #worker: Worker | undefined;
  #queue: Job[] = [];
  #inFlight: Job | undefined;
  /** The newest generation each session has asked for. */
  readonly #newest = new Map<number, number>();
  readonly #released = new Set<number>();
  #sessions = 0;
  #jobs = 0;
  #disposed = false;

  constructor(paths: GraphLayoutWorkerPaths) {
    this.#paths = paths;
  }

  /** A new session, with its own engine handle in the Worker once it lays out. */
  session(): LayoutSession {
    const session = ++this.#sessions;
    return {
      layout: (frame, options, generation) =>
        this.#layout(session, { frame, options, generation }),
      dispose: () => this.#release(session),
    };
  }

  /** Stops the Worker. Layouts still waiting resolve superseded: no panel is left to draw them. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    const worker = this.#worker;
    this.#worker = undefined;
    const pending = [this.#inFlight, ...this.#queue];
    this.#inFlight = undefined;
    this.#queue = [];
    for (const job of pending) {
      job?.resolve(undefined);
    }
    void worker?.terminate();
  }

  #layout(
    session: number,
    request: { frame: Uint8Array; options: string; generation: number },
  ): Promise<Uint8Array | undefined> {
    const { frame, options, generation } = request;
    if (this.#disposed || this.#released.has(session)) {
      return Promise.resolve(undefined);
    }
    this.#newest.set(
      session,
      Math.max(this.#newest.get(session) ?? 0, generation),
    );
    // A newer generation overtakes the session's layouts still waiting, which are never run.
    this.#dropQueued(session);
    return new Promise((resolve, reject) => {
      this.#queue.push({
        id: ++this.#jobs,
        session,
        generation,
        frame,
        options,
        resolve,
        reject,
      });
      this.#pump();
    });
  }

  #release(session: number): void {
    if (this.#released.has(session)) {
      return;
    }
    this.#released.add(session);
    this.#dropQueued(session);
    // The Worker runs its messages in order, so the release follows the session's layout in flight.
    // eslint-disable-next-line no-restricted-syntax -- the host's channel to its own Worker, not a webview
    this.#worker?.postMessage({
      kind: "release",
      session,
    } satisfies WorkerRequest);
  }

  #dropQueued(session: number): void {
    this.#queue = this.#queue.filter((job) => {
      if (job.session !== session) {
        return true;
      }
      job.resolve(undefined);
      return false;
    });
  }

  #pump(): void {
    if (this.#inFlight) {
      return;
    }
    const job = this.#queue.shift();
    if (!job) {
      return;
    }
    this.#inFlight = job;
    // eslint-disable-next-line no-restricted-syntax -- the host's channel to its own Worker, not a webview
    this.#ensureWorker().postMessage({
      kind: "layout",
      id: job.id,
      session: job.session,
      frame: job.frame,
      options: job.options,
      generation: job.generation,
    } satisfies WorkerRequest);
  }

  #ensureWorker(): Worker {
    if (this.#worker) {
      return this.#worker;
    }
    const worker = new Worker(this.#paths.entry, {
      workerData: { dir: this.#paths.wasmDir },
    });
    worker.on("message", (reply: WorkerReply) => this.#settle(reply));
    worker.on("error", (error) => this.#fail(worker, error));
    worker.on("exit", (code) =>
      this.#fail(
        worker,
        new Error(`the layout worker exited with code ${code}`),
      ),
    );
    this.#worker = worker;
    return worker;
  }

  #settle(reply: WorkerReply): void {
    const job = this.#inFlight;
    if (!job || job.id !== reply.id) {
      return;
    }
    this.#inFlight = undefined;
    if (reply.error !== undefined) {
      job.reject(new Error(reply.error));
    } else {
      const current =
        !this.#released.has(job.session) &&
        job.generation >= (this.#newest.get(job.session) ?? 0);
      job.resolve(current ? reply.frame : undefined);
    }
    this.#pump();
  }

  /** The Worker died: its layouts fail, and the next layout starts a fresh one. */
  #fail(worker: Worker, error: Error): void {
    if (this.#worker !== worker) {
      return;
    }
    this.#worker = undefined;
    const failed = [this.#inFlight, ...this.#queue];
    this.#inFlight = undefined;
    this.#queue = [];
    for (const job of failed) {
      job?.reject(error);
    }
    void worker.terminate();
  }
}
