/** How a child column derives from a parent column in Fusion's static analysis. */
export type LineageEvolution = "copy" | "mod" | "scan";

export interface ColumnRef {
  uniqueId: string;
  column: string;
}

/** One column-level edge from Fusion's `column_lineage` info schema view. */
export interface ColumnEdge {
  parent: ColumnRef;
  child: ColumnRef;
  evolution: LineageEvolution;
}

/** Outcome of one `dbt show --inline <lineage query> --output json --limit -1 --quiet`. */
export type LineageRead =
  | { kind: "edges"; edges: ColumnEdge[] }
  /** Exit 0 and `[]`: no lineage for these nodes, or no strict `--generate-info-schema` compile yet. */
  | { kind: "empty" }
  /** Exit 1 with `InfoSchemaUnavailable (dbt1656)`: no project metadata has been written. */
  | { kind: "unavailable" }
  | { kind: "failed"; message: string };

export type LineageDirection = "upstream" | "downstream";

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

/**
 * The view's column names in Fusion 2.0.6. The query names them explicitly, so a rename fails the read
 * loudly instead of returning rows of an unknown shape.
 */
const COLUMNS = {
  parentId: "parent_node_unique_id",
  parentColumn: "parent_column_name",
  childId: "child_node_unique_id",
  childColumn: "child_column_name",
  evolution: "evolution",
} as const;

const INFO_SCHEMA_UNAVAILABLE = "dbt1656";

/**
 * SQL for `dbt show --inline` that selects the edges into (`upstream`) or out of (`downstream`) the given
 * nodes. IDs must come from the manifest; single quotes are doubled regardless.
 */
export function buildLineageQuery(
  uniqueIds: readonly string[],
  direction: LineageDirection,
): string {
  const filterColumn =
    direction === "upstream" ? COLUMNS.childId : COLUMNS.parentId;
  const list = uniqueIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(", ");
  return [
    `select ${Object.values(COLUMNS).join(", ")}`,
    "from {{ info_schema('column_lineage') }}",
    `where ${filterColumn} in (${list})`,
  ].join("\n");
}

/**
 * Parses the stdout of the `--quiet` read: one JSON array. Rows of unknown shape or `evolution` are dropped,
 * and `report` is called once with their count. Throws when stdout is not a JSON array.
 */
export function parseLineageRows(
  stdout: string,
  report?: (message: string) => void,
): ColumnEdge[] {
  const parsed: unknown = JSON.parse(stdout.trim());
  if (!Array.isArray(parsed)) {
    throw new Error("dbt show did not print a JSON array");
  }
  const edges: ColumnEdge[] = [];
  let dropped = 0;
  for (const row of parsed) {
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

/** Classifies a completed read from its exit code and output. */
export function classifyLineageRead(
  result: { exitCode?: number | null; stdout: string; stderr: string },
  report?: (message: string) => void,
): LineageRead {
  if (result.exitCode !== 0) {
    if (
      `${result.stderr}\n${result.stdout}`.includes(INFO_SCHEMA_UNAVAILABLE)
    ) {
      return { kind: "unavailable" };
    }
    return {
      kind: "failed",
      message:
        result.stderr.trim() ||
        result.stdout.trim() ||
        `dbt show exited with ${result.exitCode}`,
    };
  }
  try {
    const edges = parseLineageRows(result.stdout, report);
    return edges.length > 0 ? { kind: "edges", edges } : { kind: "empty" };
  } catch (error) {
    return {
      kind: "failed",
      message: `Could not parse dbt show output: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
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

function toEdge(row: unknown): ColumnEdge | undefined {
  if (typeof row !== "object" || row === null) {
    return undefined;
  }
  const record = row as Record<string, unknown>;
  const parentId = record[COLUMNS.parentId];
  const parentColumn = record[COLUMNS.parentColumn];
  const childId = record[COLUMNS.childId];
  const childColumn = record[COLUMNS.childColumn];
  const evolution = record[COLUMNS.evolution];
  if (
    typeof parentId !== "string" ||
    typeof parentColumn !== "string" ||
    typeof childId !== "string" ||
    typeof childColumn !== "string" ||
    typeof evolution !== "string" ||
    !EVOLUTIONS.has(evolution)
  ) {
    return undefined;
  }
  return {
    parent: { uniqueId: parentId, column: parentColumn },
    child: { uniqueId: childId, column: childColumn },
    evolution: evolution as LineageEvolution,
  };
}
