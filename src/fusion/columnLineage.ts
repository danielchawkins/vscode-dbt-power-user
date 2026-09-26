/** How a child column derives from a parent column in Fusion's static analysis. */
export type LineageEvolution = "copy" | "mod" | "scan";

export interface ColumnRef {
  uniqueId: string;
  column: string;
}

/** One column-level edge from `dbt show --info column_lineage`. */
export interface ColumnEdge {
  parent: ColumnRef;
  child: ColumnRef;
  evolution: LineageEvolution;
  ingestedAt: string;
}

/** The lineage component's `ViewsTypes`, restricted to the values Fusion edges map to. */
export type PanelViewsType =
  "Unchanged" | "Alias" | "Transformation" | "Non select";

/**
 * The `ColumnLineage` shape consumed by the `@altimateai/ui-components` lineage component.
 * Defined here so the extension host does not import the webview package.
 */
export interface ColumnLineage {
  source: [table: string, column: string];
  target: [table: string, column: string];
  type: "direct" | "indirect";
  viewsType: PanelViewsType;
}

const EVOLUTIONS: ReadonlySet<string> = new Set(["copy", "mod", "scan"]);

/** Fusion 2.0.5 and 2.0.6 binaries use `parent_*`/`child_*`; the public source uses `from_*`/`to_*`. */
const COLUMN_SETS = [
  {
    parentId: "parent_node_unique_id",
    parentColumn: "parent_column_name",
    childId: "child_node_unique_id",
    childColumn: "child_column_name",
    evolution: "evolution",
  },
  {
    parentId: "from_node_unique_id",
    parentColumn: "from_column_name",
    childId: "to_node_unique_id",
    childColumn: "to_column_name",
    evolution: "lineage_kind",
  },
] as const;

/**
 * Parses `dbt show --info column_lineage --output json` stdout into edges.
 *
 * The JSON array is located among Fusion's log and summary lines. Rows of unknown shape or
 * `evolution` are dropped, and `report` is called once with their count.
 */
export function parseColumnLineage(
  stdout: string,
  report?: (message: string) => void,
): ColumnEdge[] {
  const rows = findJsonArray(stdout);
  const edges: ColumnEdge[] = [];
  let dropped = 0;
  for (const row of rows) {
    const edge = toEdge(row);
    if (edge) {
      edges.push(edge);
    } else {
      dropped++;
    }
  }
  if (dropped > 0) {
    report?.(
      `Ignored ${dropped} column lineage row(s) of unknown shape from dbt show.`,
    );
  }
  return edges;
}

/**
 * Maps edges to the lineage panel's shape. `nodeTable` resolves a unique ID to the panel's
 * table key; edges with an unresolved end are dropped.
 */
export function toPanelLineage(
  edges: ColumnEdge[],
  nodeTable: (uniqueId: string) => string | undefined,
): ColumnLineage[] {
  const lineage: ColumnLineage[] = [];
  for (const { parent, child, evolution } of edges) {
    const sourceTable = nodeTable(parent.uniqueId);
    const targetTable = nodeTable(child.uniqueId);
    if (sourceTable === undefined || targetTable === undefined) {
      continue;
    }
    lineage.push({
      source: [sourceTable, parent.column],
      target: [targetTable, child.column],
      ...panelKind(evolution, parent.column === child.column),
    });
  }
  return lineage;
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
  }
}

function findJsonArray(stdout: string): unknown[] {
  const candidates = [stdout.trim(), ...stdout.split(/\r?\n/)];
  for (const candidate of candidates) {
    const text = candidate.trim();
    if (!text.startsWith("[")) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // A bracketed log line, not the result array.
    }
  }
  return [];
}

function toEdge(row: unknown): ColumnEdge | undefined {
  if (typeof row !== "object" || row === null) {
    return undefined;
  }
  const record = row as Record<string, unknown>;
  for (const names of COLUMN_SETS) {
    const parentId = record[names.parentId];
    const parentColumn = record[names.parentColumn];
    const childId = record[names.childId];
    const childColumn = record[names.childColumn];
    const evolution = record[names.evolution];
    if (
      typeof parentId === "string" &&
      typeof parentColumn === "string" &&
      typeof childId === "string" &&
      typeof childColumn === "string" &&
      typeof evolution === "string"
    ) {
      if (!EVOLUTIONS.has(evolution)) {
        return undefined;
      }
      const ingestedAt = record.ingested_at;
      return {
        parent: { uniqueId: parentId, column: parentColumn },
        child: { uniqueId: childId, column: childColumn },
        evolution: evolution as LineageEvolution,
        ingestedAt: typeof ingestedAt === "string" ? ingestedAt : "",
      };
    }
  }
  return undefined;
}
