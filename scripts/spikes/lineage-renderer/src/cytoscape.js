// cytoscape: tables are compound parents, columns are child nodes, column lineage edges join column nodes.
// Positions come from the shared level layout, so the measured layout time is that pass plus cytoscape's own.
import cytoscape from "cytoscape";
import { bench } from "./bench.js";
import { columnId, columnY, geometry, levelLayout, tableHeight } from "./lineageData.js";

void bench("cytoscape", async (data, host, hooks) => {
  host.style.cssText = "position:absolute;inset:0;background:#1e1e1e";
  const positions = await hooks.layout(() => levelLayout(data));
  const elements = [];
  for (const t of data.tables) {
    const p = positions.get(t.table);
    elements.push({
      data: { id: t.table, label: `${t.nodeType} ${t.label}  ↑${t.parentCount} ↓${t.childCount}` },
      classes: "table",
    });
    elements.push({
      data: { id: `${t.table}#header`, parent: t.table, label: t.label },
      position: { x: p.x + geometry.tableWidth / 2, y: p.y + geometry.headerHeight / 2 },
      classes: "header",
    });
    t.columns.forEach((c, i) => {
      elements.push({
        data: { id: columnId(t.table, c.name), parent: t.table, label: c.name },
        position: { x: p.x + geometry.tableWidth / 2, y: p.y + columnY(i) + geometry.columnHeight / 2 },
        classes: "column",
      });
    });
    if (!t.columns.length) {
      elements.at(-1).position.y = p.y + tableHeight(t) / 2;
    }
  }
  for (const e of data.edges) {
    elements.push({ data: { id: `${e.source}->${e.target}`, source: `${e.source}#header`, target: `${e.target}#header` }, classes: "table-edge" });
  }
  for (const e of data.columnEdges) {
    const source = columnId(...e.source);
    const target = columnId(...e.target);
    elements.push({ data: { id: `${source}->${target}`, source, target }, classes: `column-edge ${e.type}` });
  }
  const cy = await hooks.layout(() =>
    cytoscape({
      container: host,
      elements,
      layout: { name: "preset", fit: true, padding: 20 },
      minZoom: 0.05,
      style: [
        { selector: "node.table", style: { "background-color": "#252526", "border-color": "#3c3c3c", "border-width": 1, label: "data(label)", color: "#ddd", "font-size": 12, "text-valign": "top", "text-halign": "center", padding: 12, shape: "round-rectangle" } },
        { selector: "node.header", style: { width: geometry.tableWidth - 24, height: geometry.headerHeight - 12, "background-color": "#252526", label: "data(label)", color: "#ddd", "font-size": 12, "text-valign": "center", shape: "rectangle" } },
        { selector: "node.column", style: { width: geometry.tableWidth - 24, height: geometry.columnHeight, "background-color": "#2d2d30", label: "data(label)", color: "#ddd", "font-size": 11, "text-valign": "center", shape: "round-rectangle" } },
        { selector: "edge.table-edge", style: { width: 2, "line-color": "#888", "curve-style": "bezier", "target-arrow-shape": "triangle", "target-arrow-color": "#888" } },
        { selector: "edge.column-edge", style: { width: 1, "line-color": "#247efe", "curve-style": "unbundled-bezier" } },
        { selector: "edge.indirect", style: { "line-color": "#c586c0", "line-style": "dashed" } },
      ],
    }),
  );
  cy.one("render", () => hooks.drawn());
  cy.forceRender?.();
  return {
    viewport: () => `${cy.pan().x.toFixed(1)},${cy.pan().y.toFixed(1)} zoom ${cy.zoom().toFixed(3)}`,
    counts: () => ({
      tables: cy.nodes(".table").length,
      columns: cy.nodes(".column").length,
      edges: cy.edges().length,
    }),
  };
});
