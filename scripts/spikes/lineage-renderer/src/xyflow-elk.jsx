import ELK from "elkjs/lib/elk.bundled.js";
import { bench } from "./bench.js";
import { geometry, tableHeight } from "./lineageData.js";
import { renderXyflow } from "./xyflow.jsx";

// `elk.bundled.js` runs the layout on the main thread; the worker build needs `worker-src blob:` or a worker file.
const elk = new ELK();

async function layout(data) {
  const graph = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.layered.spacing.nodeNodeBetweenLayers": "280",
      "elk.spacing.nodeNode": "80",
    },
    children: data.tables.map((t) => ({ id: t.table, width: geometry.tableWidth, height: tableHeight(t) })),
    edges: data.edges.map((e, i) => ({ id: `e${i}`, sources: [e.source], targets: [e.target] })),
  });
  return new Map(graph.children.map((c) => [c.id, { x: c.x, y: c.y }]));
}

void bench("xyflow-elk", renderXyflow(layout));
