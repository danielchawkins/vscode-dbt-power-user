import type { LayoutInput } from "./engine/layoutRequest";

/**
 * The kinds of edge the panel draws, which the Scope control switches on or off as a whole. A `model` or `source`
 * edge is a dbt dependency, told apart by its parent's node type; `grouped` joins a collapsed group to its table;
 * `column` joins two column rows; `relationship` is a declared relationship such as a foreign key.
 */
export type EdgeGroup =
  | "model"
  | "source"
  | "grouped"
  | "column"
  | "relationship";

/** The groups in the order the Scope control lists them. */
const EDGE_GROUPS: readonly EdgeGroup[] = [
  "model",
  "source",
  "grouped",
  "column",
  "relationship",
];

/** The label each group has in the Scope control. */
export const EDGE_GROUP_LABELS: Record<EdgeGroup, string> = {
  model: "Model dependencies",
  source: "Source dependencies",
  grouped: "Grouped dependencies",
  column: "Column edges",
  relationship: "Relationships",
};

/** The group of each table edge `[parent, child]`: a source's edge is `source`, any other dependency `model`. */
const tableGroupOf = (layout: LayoutInput) => {
  const sources = new Set(
    layout.data.tables
      .filter((table) => table.nodeType === "source")
      .map((table) => table.table),
  );
  return (parent: string): EdgeGroup =>
    sources.has(parent) ? "source" : "model";
};

/**
 * The edge groups the layout input draws at least one edge in, in the Scope control's order. A group switched off is
 * still listed here, so the control can switch it back on.
 */
export const edgeGroupsOf = (layout: LayoutInput): EdgeGroup[] => {
  const present = new Set<EdgeGroup>();
  const groupOf = tableGroupOf(layout);
  for (const [parent] of layout.data.edges) {
    present.add(groupOf(parent));
  }
  if ((layout.groupEdges ?? []).length > 0) {
    present.add("grouped");
  }
  if (layout.data.columnEdges.length > 0) {
    present.add("column");
  }
  if (layout.refs.length > 0) {
    present.add("relationship");
  }
  return EDGE_GROUPS.filter((group) => present.has(group));
};

/**
 * The layout input without the edges of the groups `off` names, and nothing else. Nothing off returns `layout` itself,
 * so switching the last group back on restores the input exactly.
 */
export const withoutEdgeGroups = (
  layout: LayoutInput,
  off: readonly string[],
): LayoutInput => {
  if (off.length === 0) {
    return layout;
  }
  const gone = new Set<string>(off);
  const groupOf = tableGroupOf(layout);
  return {
    ...layout,
    data: {
      ...layout.data,
      edges: layout.data.edges.filter(([parent]) => !gone.has(groupOf(parent))),
      columnEdges: gone.has("column") ? [] : layout.data.columnEdges,
    },
    groupEdges: gone.has("grouped") ? [] : layout.groupEdges,
    refs: gone.has("relationship") ? [] : layout.refs,
  };
};
