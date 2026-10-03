// sigma + graphology: WebGL nodes and edges. Sigma draws circles and labels, not tables, so each table is a header
// node plus one node per column placed in a column stack; column lineage edges join column nodes.
import Graph from "graphology";
import Sigma from "sigma";
import { bench } from "./bench.js";
import { columnId, columnY, geometry, levelLayout } from "./lineageData.js";

void bench("sigma", async (data, host, hooks) => {
  host.style.cssText = "position:absolute;inset:0;background:#1e1e1e";
  const positions = await hooks.layout(() => levelLayout(data));
  const graph = new Graph({ multi: false, type: "directed" });
  for (const t of data.tables) {
    const p = positions.get(t.table);
    // graphology's y axis points up.
    graph.addNode(t.table, {
      x: p.x + geometry.tableWidth / 2,
      y: -(p.y + geometry.headerHeight / 2),
      size: 8,
      label: `${t.label}  ↑${t.parentCount} ↓${t.childCount}`,
      color: "#9cdcfe",
    });
    t.columns.forEach((c, i) => {
      graph.addNode(columnId(t.table, c.name), {
        x: p.x + geometry.tableWidth / 2,
        y: -(p.y + columnY(i) + geometry.columnHeight / 2),
        size: 3,
        label: c.name,
        color: "#888",
      });
    });
  }
  for (const e of data.edges) {
    graph.mergeEdge(e.source, e.target, { size: 2, color: "#888" });
  }
  for (const e of data.columnEdges) {
    graph.mergeEdge(columnId(...e.source), columnId(...e.target), {
      size: 1,
      color: e.type === "direct" ? "#247efe" : "#c586c0",
    });
  }
  const renderer = await hooks.layout(
    () =>
      new Sigma(graph, host, {
        labelColor: { color: "#ddd" },
        labelRenderedSizeThreshold: 0,
        renderEdgeLabels: false,
        minCameraRatio: 0.05,
        maxCameraRatio: 20,
      }),
  );
  renderer.once("afterRender", () => hooks.drawn());
  renderer.refresh();
  return {
    viewport: () => {
      const s = renderer.getCamera().getState();
      return `${s.x.toFixed(4)},${s.y.toFixed(4)} ratio ${s.ratio.toFixed(3)}`;
    },
    counts: () => ({
      tables: data.tables.length,
      columns: graph.order - data.tables.length,
      edges: graph.size,
    }),
  };
});
