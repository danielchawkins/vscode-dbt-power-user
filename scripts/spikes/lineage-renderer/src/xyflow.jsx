// `@xyflow/react` with every table drawn as one custom node listing its columns, and one edge per column lineage
// edge between column handles. `layout` positions the tables; elk and dagre share everything else.
import { Handle, Position, ReactFlow, ReactFlowProvider, useStore } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { memo, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { columnId, geometry, tableHeight } from "./lineageData.js";
import "./xyflow.css";

const TableNode = memo(({ data }) => (
  <div className="table-node" style={{ width: geometry.tableWidth, height: tableHeight(data.table) }}>
    <div className="table-header">
      <span className="type">{data.table.nodeType}</span>
      <span className="label">{data.table.label}</span>
      <span className="counts">
        ↑{data.table.parentCount} ↓{data.table.childCount}
      </span>
      <Handle type="target" position={Position.Left} id="t" />
      <Handle type="source" position={Position.Right} id="s" />
    </div>
    {data.table.columns.map((c) => (
      <div className="column" key={c.name} style={{ height: geometry.columnHeight }}>
        <Handle type="target" position={Position.Left} id={`t:${c.name}`} />
        <span>{c.name}</span>
        <span className="dtype">{c.data_type ?? ""}</span>
        <Handle type="source" position={Position.Right} id={`s:${c.name}`} />
      </div>
    ))}
  </div>
));

const nodeTypes = { table: TableNode };

function Drawn({ onDrawn }) {
  const ready = useStore((s) => s.nodes.length > 0 && s.nodes.every((n) => n.measured?.width));
  useEffect(() => {
    if (ready) {
      onDrawn();
    }
  }, [ready, onDrawn]);
  return null;
}

/** Converts `LineageData` into React Flow nodes and edges; `positions` maps a table to its top-left corner. */
export function toFlow(data, positions) {
  const nodes = data.tables.map((t) => ({
    id: t.table,
    type: "table",
    position: positions.get(t.table),
    data: { table: t },
  }));
  const tableEdges = data.edges.map((e) => ({
    id: `${e.source}->${e.target}`,
    source: e.source,
    target: e.target,
    sourceHandle: "s",
    targetHandle: "t",
    className: "table-edge",
  }));
  const flags = new URLSearchParams(location.search);
  const columnEdges = flags.has("noColumnEdges")
    ? []
    : data.columnEdges.map((e) => ({
    id: `${columnId(...e.source)}->${columnId(...e.target)}`,
    source: e.source[0],
    target: e.target[0],
    sourceHandle: `s:${e.source[1]}`,
    targetHandle: `t:${e.target[1]}`,
    className: e.type === "direct" ? "column-edge" : "column-edge indirect",
  }));
  return { nodes, edges: [...tableEdges, ...columnEdges] };
}

/** Renders with `@xyflow/react`; `layout(data)` resolves to the table positions. `?solid` draws indirect edges solid. */
export function renderXyflow(layout) {
  return async (data, host, hooks) => {
    if (new URLSearchParams(location.search).has("solid")) {
      host.classList.add("solid");
    }
    const positions = await hooks.layout(() => layout(data));
    const { nodes, edges } = toFlow(data, positions);
    createRoot(host).render(
      <ReactFlowProvider>
        <ReactFlow
          defaultNodes={nodes}
          defaultEdges={edges}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.05}
          proOptions={{ hideAttribution: true }}
        />
        <Drawn onDrawn={hooks.drawn} />
      </ReactFlowProvider>,
    );
    return {
      viewport: () => host.querySelector(".react-flow__viewport")?.style.transform ?? "",
      counts: () => ({
        tables: host.querySelectorAll(".react-flow__node").length,
        columns: host.querySelectorAll(".table-node .column").length,
        edges: host.querySelectorAll(".react-flow__edge").length,
      }),
    };
  };
}
