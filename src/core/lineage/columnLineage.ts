/** How a child column derives from a parent column in Fusion's static analysis; `unknown` for any other `op`. */
type LineageEvolution = "copy" | "mod" | "scan" | "unknown";

interface ColumnRef {
  uniqueId: string;
  column: string;
}

/** One column-level edge: `child` is computed from `parent`. */
export interface ColumnEdge {
  parent: ColumnRef;
  child: ColumnRef;
  evolution: LineageEvolution;
}

/** The lineage component's `ViewsTypes`, restricted to the values Fusion edges map to. */
type PanelViewsType =
  "Unchanged" | "Alias" | "Transformation" | "Non select" | "Not sure";

/**
 * The `ColumnLineage` shape consumed by the vendored lineage component.
 * Defined here so the extension host does not import the webview package.
 */
export interface ColumnLineage {
  source: [table: string, column: string];
  target: [table: string, column: string];
  type: "direct" | "indirect";
  viewsType: PanelViewsType;
}

/**
 * A `dbt.listNodes` result as Fusion 2.0.6 sends it, restricted to the fields read here. At column grain each
 * node is one column: `unique_id` is `<node unique_id>.<name>` and `parents` are column ids of the same form.
 */
export interface ListNodesResult {
  error?: string | null;
  nodes?: unknown[];
}

/** `dbt.listNodes` arguments for the column lineage of one column, as the official client sends them. */
export function columnLineageArgs(uniqueId: string, column: string): string[] {
  return [`@${uniqueId}`, `+column:${uniqueId}.${column}+`];
}

/**
 * The edges of a column-grain result, one per entry in a node's `parents`, deduplicated and in first-seen
 * order. Nodes of unknown shape are skipped. A parent that is itself a node keeps that node's split into
 * table and column; any other parent id splits at its last `.`.
 */
export function columnEdges(result: ListNodesResult): ColumnEdge[] {
  const columns = (result.nodes ?? []).flatMap((node) => {
    const column = toColumnNode(node);
    return column ? [column] : [];
  });
  const refs = new Map(columns.map((column) => [column.id, column.ref]));
  const edges = new Map<string, ColumnEdge>();
  for (const { id, ref, parents, evolution } of columns) {
    for (const parentId of parents) {
      const parent = refs.get(parentId) ?? splitColumnId(parentId);
      const key = `${parentId}\u0000${id}`;
      if (parent && !edges.has(key)) {
        edges.set(key, { parent, child: ref, evolution });
      }
    }
  }
  return [...edges.values()];
}

/** Maps edges to the lineage panel's shape. */
export function toPanelLineage(edges: readonly ColumnEdge[]): ColumnLineage[] {
  return edges.map(({ parent, child, evolution }) => ({
    source: [parent.uniqueId, parent.column],
    target: [child.uniqueId, child.column],
    ...panelKind(
      evolution,
      parent.column.toLowerCase() === child.column.toLowerCase(),
    ),
  }));
}

function panelKind(
  evolution: LineageEvolution,
  sameName: boolean,
): Pick<ColumnLineage, "type" | "viewsType"> {
  switch (evolution) {
    case "copy":
      return { type: "direct", viewsType: sameName ? "Unchanged" : "Alias" };
    case "mod":
      return { type: "direct", viewsType: "Transformation" };
    case "scan":
      return { type: "indirect", viewsType: "Non select" };
    case "unknown":
      return { type: "direct", viewsType: "Not sure" };
  }
}

interface ColumnNode {
  id: string;
  ref: ColumnRef;
  parents: string[];
  evolution: LineageEvolution;
}

function toColumnNode(node: unknown): ColumnNode | undefined {
  if (typeof node !== "object" || node === null) {
    return undefined;
  }
  const { unique_id: id, name, parents, op } = node as Record<string, unknown>;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    name.length === 0 ||
    !id.endsWith(`.${name}`) ||
    id.length <= name.length + 1
  ) {
    return undefined;
  }
  return {
    id,
    ref: { uniqueId: id.slice(0, -(name.length + 1)), column: name },
    parents: Array.isArray(parents)
      ? parents.filter((p): p is string => typeof p === "string")
      : [],
    evolution: toEvolution(op),
  };
}

/** `op` is the edge kind of every parent of the node. */
function toEvolution(op: unknown): LineageEvolution {
  return op === "copy" || op === "mod" || op === "scan" ? op : "unknown";
}

// Wrong for a column name containing `.`; only reached for a parent the result does not list as a node.
function splitColumnId(id: string): ColumnRef | undefined {
  const dot = id.lastIndexOf(".");
  return dot > 0 && dot < id.length - 1
    ? { uniqueId: id.slice(0, dot), column: id.slice(dot + 1) }
    : undefined;
}
