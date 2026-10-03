import dagre from "@dagrejs/dagre";
import { bench } from "./bench.js";
import { geometry, tableHeight } from "./lineageData.js";
import { renderXyflow } from "./xyflow.jsx";

function layout(data) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", ranksep: 280, nodesep: 80 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const t of data.tables) {
    g.setNode(t.table, { width: geometry.tableWidth, height: tableHeight(t) });
  }
  for (const e of data.edges) {
    g.setEdge(e.source, e.target);
  }
  dagre.layout(g);
  // dagre positions node centres.
  return new Map(
    data.tables.map((t) => {
      const n = g.node(t.table);
      return [t.table, { x: n.x - n.width / 2, y: n.y - n.height / 2 }];
    }),
  );
}

void bench("xyflow-dagre", renderXyflow(layout));
