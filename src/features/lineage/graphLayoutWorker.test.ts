import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerReply, WorkerRequest } from "./graphLayoutWorker";

const { workers, FakeWorker } = vi.hoisted(() => {
  const workers: FakeWorker[] = [];
  /** A Worker at its message boundary: what the host posts is recorded, and the test replies by hand. */
  class FakeWorker {
    readonly messages: WorkerRequest[] = [];
    readonly listeners = new Map<string, (...args: unknown[]) => void>();
    terminated = false;
    readonly entry: string;
    readonly options: unknown;

    constructor(entry: string, options: unknown) {
      this.entry = entry;
      this.options = options;
      workers.push(this);
    }

    on(event: string, listener: (...args: unknown[]) => void): this {
      this.listeners.set(event, listener);
      return this;
    }

    postMessage(message: WorkerRequest): void {
      this.messages.push(message);
    }

    terminate(): Promise<number> {
      this.terminated = true;
      return Promise.resolve(0);
    }

    reply(message: WorkerReply): void {
      this.listeners.get("message")?.(message);
    }
  }
  return { workers, FakeWorker };
});

vi.mock("node:worker_threads", () => ({ Worker: FakeWorker }));

import { GraphLayoutWorker } from "./graphLayoutWorker";

const PATHS = {
  entry: "/ext/dist/graphLayoutThread.js",
  wasmDir: "/ext/dist/graph-layout",
};
const GRAPH = new Uint8Array([1, 2, 3]);
const OPTIONS = '{"effort":"balanced"}';

const resetWorkers = () => {
  workers.length = 0;
};

describe("GraphLayoutWorker: requests", () => {
  beforeEach(resetWorkers);

  it("starts the Worker lazily, on the first layout", () => {
    const worker = new GraphLayoutWorker(PATHS);
    const session = worker.session();
    expect(workers).toHaveLength(0);
    void session.layout(GRAPH, OPTIONS, 1);
    expect(workers).toHaveLength(1);
    expect(workers[0]?.entry).toBe(PATHS.entry);
    expect(workers[0]?.options).toEqual({ workerData: { dir: PATHS.wasmDir } });
  });

  it("sends the request to the Worker and resolves to the frame it answers with", async () => {
    const worker = new GraphLayoutWorker(PATHS);
    const pending = worker.session().layout(GRAPH, OPTIONS, 4);
    const sent = workers[0]?.messages[0];
    expect(sent).toEqual({
      kind: "layout",
      id: 1,
      session: 1,
      frame: GRAPH,
      options: OPTIONS,
      generation: 4,
    });
    workers[0]?.reply({ id: 1, frame: new Uint8Array([9, 8]) });
    await expect(pending).resolves.toEqual(new Uint8Array([9, 8]));
  });

  it("rejects when the Worker answers with an error", async () => {
    const worker = new GraphLayoutWorker(PATHS);
    const pending = worker.session().layout(GRAPH, OPTIONS, 1);
    workers[0]?.reply({ id: 1, error: "the frame does not decode" });
    await expect(pending).rejects.toThrow("the frame does not decode");
  });
});

describe("GraphLayoutWorker: superseded generations", () => {
  beforeEach(resetWorkers);

  it("drops a superseded generation: its answer is undefined, and a queued one is never sent", async () => {
    const worker = new GraphLayoutWorker(PATHS);
    const session = worker.session();
    const first = session.layout(GRAPH, OPTIONS, 1);
    const second = session.layout(GRAPH, OPTIONS, 2);
    const third = session.layout(GRAPH, OPTIONS, 3);
    await expect(second).resolves.toBeUndefined();

    const sent = workers[0]?.messages.map((message) =>
      message.kind === "layout" ? message.generation : message.kind,
    );
    expect(sent).toEqual([1]);

    workers[0]?.reply({ id: 1, frame: new Uint8Array([1]) });
    await expect(first).resolves.toBeUndefined();
    expect(workers[0]?.messages.at(-1)).toMatchObject({
      kind: "layout",
      id: 3,
      generation: 3,
    });
    workers[0]?.reply({ id: 3, frame: new Uint8Array([3]) });
    await expect(third).resolves.toEqual(new Uint8Array([3]));
  });

  it("drops an in-flight generation a newer one overtook while it ran", async () => {
    const worker = new GraphLayoutWorker(PATHS);
    const session = worker.session();
    const first = session.layout(GRAPH, OPTIONS, 1);
    void session.layout(GRAPH, OPTIONS, 2);
    workers[0]?.reply({ id: 1, frame: new Uint8Array([1]) });
    await expect(first).resolves.toBeUndefined();
  });

  it("keeps the sessions of two panels apart: a newer generation of one does not drop the other's", async () => {
    const worker = new GraphLayoutWorker(PATHS);
    const panelA = worker.session();
    const panelB = worker.session();
    const a = panelA.layout(GRAPH, OPTIONS, 1);
    const b = panelB.layout(GRAPH, OPTIONS, 1);
    workers[0]?.reply({ id: 1, frame: new Uint8Array([1]) });
    workers[0]?.reply({ id: 2, frame: new Uint8Array([2]) });
    await expect(a).resolves.toEqual(new Uint8Array([1]));
    await expect(b).resolves.toEqual(new Uint8Array([2]));
  });
});

describe("GraphLayoutWorker: disposal", () => {
  beforeEach(resetWorkers);

  it("disposing the worker terminates it and resolves what is waiting as superseded", async () => {
    const worker = new GraphLayoutWorker(PATHS);
    const pending = worker.session().layout(GRAPH, OPTIONS, 1);
    worker.dispose();
    await expect(pending).resolves.toBeUndefined();
    expect(workers[0]?.terminated).toBe(true);
  });

  it("releasing a session frees its handle in the Worker; a released session's layouts are superseded", async () => {
    const worker = new GraphLayoutWorker(PATHS);
    const session = worker.session();
    const first = session.layout(GRAPH, OPTIONS, 1);
    session.dispose();
    workers[0]?.reply({ id: 1, frame: new Uint8Array([1]) });
    await expect(first).resolves.toBeUndefined();
    expect(workers[0]?.messages.at(-1)).toEqual({
      kind: "release",
      session: 1,
    });
    await expect(session.layout(GRAPH, OPTIONS, 2)).resolves.toBeUndefined();
    expect(
      workers[0]?.messages.filter((m) => m.kind === "layout"),
    ).toHaveLength(1);
  });

  it("disposing twice does not terminate twice", () => {
    const worker = new GraphLayoutWorker(PATHS);
    void worker.session().layout(GRAPH, OPTIONS, 1);
    worker.dispose();
    worker.dispose();
    expect(workers).toHaveLength(1);
  });
});
