// The incumbent: `@altimateai/ui-components` lineage as the repository installs it, driven through its `static`
// lineage type, which takes table edges, per-table columns and column edges in one call and lays them out with the
// same `layoutElementsOnCanvas` and node components as the panel's dynamic lineage.
import { ApiHelper, Lineage, TooltipProvider } from "@altimateai/ui-components/lineage";
import "@altimateai/ui-components/styles.css";
// The lineage entry loads Bootstrap through `baseStyles.ts`; the component relies on its `d-none`.
import "bootstrap/dist/css/bootstrap.min.css";
import { createRoot } from "react-dom/client";
import { bench, untilFrame } from "./bench.js";
import { columnId } from "./lineageData.js";
import "./incumbent.css";

// The static path defers its graph build by `setTimeout(…, 500)` and `fitView` by 1000 ms to wait for React Flow's
// `onInit`, which has no DOM signal. The shim runs each deferred call on the next frame instead and re-runs the build
// until nodes appear; the run that drew them is this candidate's layout time (node creation, column nodes and
// edges, `layoutElementsOnCanvas`).
const realSetTimeout = window.setTimeout;
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const drawnNodes = () => document.querySelectorAll(".react-flow__node").length;
window.setTimeout = (fn, ms, ...rest) => {
  if (ms < 500 || typeof fn !== "function") {
    return realSetTimeout(fn, ms, ...rest);
  }
  void (async () => {
    for (let attempt = 0; attempt < 120; attempt++) {
      await nextFrame();
      const t0 = performance.now();
      try {
        await fn(...rest);
      } catch (error) {
        window.__bench.errors.push(`deferred(${ms}): ${error?.stack ?? error}`);
      }
      const elapsed = performance.now() - t0;
      await nextFrame();
      // The build (500 ms) and `fitView` (1000 ms) both need the instance and the nodes.
      if (drawnNodes() > 0) {
        if (ms === 500) {
          window.__bench.layoutMs = elapsed;
          window.__bench.layoutAttempts = attempt + 1;
        } else {
          // `fitView({ duration: 500 })` animates; wait it out so every candidate pans a fitted graph.
          await new Promise((resolve) => realSetTimeout(resolve, 600));
          window.__bench.fitted = true;
        }
        return;
      }
    }
  })();
  return 0;
};

const calls = [];
ApiHelper.get = async (url) => {
  calls.push(url);
  return undefined;
};
ApiHelper.post = async (url) => {
  calls.push(url);
  return undefined;
};
window.__incumbentCalls = calls;

void bench("incumbent", async (data, host, hooks) => {
  const details = Object.fromEntries(
    data.tables.map((t) => [
      t.table,
      {
        name: t.label,
        type: t.nodeType,
        nodeType: t.nodeType,
        nodeId: t.table,
        columns: t.columns.map((c) => ({ name: c.name, datatype: c.data_type ?? undefined, table: t.table })),
      },
    ]),
  );
  const startColumn = data.tables.find((t) => t.table === data.start)?.columns[0]?.name ?? "";
  const staticLineage = {
    selectedColumn: { table: data.start, name: startColumn },
    collectColumns: Object.fromEntries(data.tables.map((t) => [t.table, t.columns.map((c) => ({ column: c.name }))])),
    columnEdges: data.columnEdges.map((e) => [columnId(...e.source), columnId(...e.target), e.type]),
    tableEdges: data.edges.map((e) => [e.source, e.target]),
    details,
  };
  host.className = "al-tw-scope incumbent-host";
  createRoot(host).render(
    <TooltipProvider>
      <Lineage theme="dark" lineageType="static" staticLineage={staticLineage} />
    </TooltipProvider>,
  );
  const columns = data.tables.reduce((a, t) => a + t.columns.length, 0);
  void untilFrame(
    () =>
      host.querySelectorAll(".react-flow__node-table").length === data.tables.length &&
      host.querySelectorAll(".react-flow__node-column").length === columns,
  ).then(hooks.drawn);
  return {
    // The component's own deferred `fitView` runs before React Flow has measured the nodes and leaves the view at
    // scale 1; the Controls fit button applies the same fit the other candidates start from.
    settled: untilFrame(() => window.__bench.fitted && drawnNodes() > 0).then(async () => {
      const fit = () => host.querySelector(".react-flow__controls-fitview")?.click();
      const transform = () => host.querySelector(".react-flow__viewport")?.style.transform ?? "";
      for (let i = 0; i < 60 && transform().includes("scale(1)"); i++) {
        fit();
        await nextFrame();
      }
      await new Promise((resolve) => realSetTimeout(resolve, 100));
    }),
    viewport: () => host.querySelector(".react-flow__viewport")?.style.transform ?? "",
    counts: () => ({
      tables: host.querySelectorAll(".react-flow__node-table").length,
      columns: host.querySelectorAll(".react-flow__node-column").length,
      edges: host.querySelectorAll(".react-flow__edge").length,
    }),
  };
});
