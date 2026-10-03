// Shared measurement harness: every candidate page calls `bench(name, render)`; run.mjs reads `window.__bench` and
// calls `window.__benchPan`. Clocks are the page's own `performance.now()`, which starts at navigation.
const graphs = import.meta.glob("../data/{p50,p95,max}.json", { import: "default" });

const state = { violations: [], errors: [], longTasks: [] };
window.__bench = state;
document.addEventListener("securitypolicyviolation", (e) =>
  state.violations.push(`${e.violatedDirective} ${e.blockedURI}`),
);
window.addEventListener("error", (e) => state.errors.push(String(e.message)));
window.addEventListener("unhandledrejection", (e) => state.errors.push(String(e.reason?.message ?? e.reason)));
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.name === "first-contentful-paint") {
      state.fcp = entry.startTime;
    }
  }
}).observe({ type: "paint", buffered: true });
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    state.longTasks.push({ start: Math.round(entry.startTime), ms: Math.round(entry.duration) });
  }
}).observe({ type: "longtask", buffered: true });

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/**
 * Loads the graph named by `?graph=`, renders it with `render`, and marks the page ready once the candidate reports
 * every table and column drawn.
 * @param {string} name
 * @param {(data: import("./lineageData.js").LineageData, host: HTMLElement, hooks: {
 *   layout: <T>(fn: () => T | Promise<T>) => Promise<T>, drawn: () => void }) => Promise<{
 *   viewport: () => string }>} render
 */
export async function bench(name, render) {
  const graph = new URLSearchParams(location.search).get("graph") ?? "p50";
  state.candidate = name;
  state.graph = graph;
  const data = await graphs[`../data/${graph}.json`]();
  state.size = {
    tables: data.tables.length,
    edges: data.edges.length,
    columns: data.tables.reduce((a, t) => a + t.columns.length, 0),
    columnEdges: data.columnEdges.length,
  };
  const host = document.getElementById("root");
  let markDrawn;
  const drawn = new Promise((resolve) => (markDrawn = resolve));
  state.dataAt = performance.now();
  try {
    const api = await render(data, host, {
      layout: async (fn) => {
        const t0 = performance.now();
        const value = await fn();
        state.layoutMs = (state.layoutMs ?? 0) + (performance.now() - t0);
        return value;
      },
      drawn: () => markDrawn(),
    });
    await drawn;
    await nextFrame();
    await nextFrame();
    state.drawnAt = performance.now();
    // A candidate whose fit animates reports `settled`; the pan starts from the fitted view.
    await api.settled;
    window.__benchApi = api;
    state.ready = true;
  } catch (error) {
    state.errors.push(String(error?.stack ?? error));
    state.failed = true;
  }
}

/** Resolves once `check` returns true, testing every frame. */
export async function untilFrame(check) {
  while (!check()) {
    await nextFrame();
  }
}

/**
 * Drags the canvas from `(x, y)` with one synthetic pointer and mouse move per animation frame, left then back.
 * Returns the rAF deltas and, per frame, the main-thread time from the rAF callback to the first task after the
 * frame's rendering steps: the frame's own cost, which vsync does not hide.
 */
window.__benchPan = async ({ x, y, frames = 120, dx = 4, dy = 2 }) => {
  const target = document.elementFromPoint(x, y);
  const init = (type, buttons) => ({
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: x,
    clientY: y,
    screenX: x,
    screenY: y,
    button: 0,
    buttons,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
  });
  const fire = (down, up, buttons, el) => {
    el.dispatchEvent(new PointerEvent(down, init(down, buttons)));
    el.dispatchEvent(new MouseEvent(up, init(up, buttons)));
  };
  const before = window.__benchApi.viewport();
  fire("pointerdown", "mousedown", 1, target);
  await nextFrame();
  const deltas = [];
  const work = [];
  let mid;
  let last = performance.now();
  for (let i = 0; i < frames; i++) {
    const sign = i < frames / 2 ? -1 : 1;
    x += sign * dx;
    y += sign * dy;
    const t0 = performance.now();
    fire("pointermove", "mousemove", 1, document.elementFromPoint(x, y) ?? target);
    const dispatched = performance.now();
    const { start, end } = await new Promise((resolve) =>
      requestAnimationFrame(() => {
        const channel = new MessageChannel();
        const s = performance.now();
        channel.port1.onmessage = () => resolve({ start: s, end: performance.now() });
        channel.port2.postMessage(0);
      }),
    );
    deltas.push(start - last);
    // The move's handlers plus the frame's style, layout and paint, which run after the rAF callback.
    work.push(dispatched - t0 + (end - start));
    last = start;
    if (i === frames / 2 - 1) {
      mid = window.__benchApi.viewport();
    }
  }
  fire("pointerup", "mouseup", 0, document.elementFromPoint(x, y) ?? target);
  return { deltas, work, moved: before !== mid, before };
};
