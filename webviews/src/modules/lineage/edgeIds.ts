import type { lineage } from "@fusion-power-user/webview-contract";

/**
 * The React Flow ids of lineage edges. An id names the edge's kind with a prefix: `t:` a dbt table edge, `g:` a group
 * edge, `c:` a column edge, `r:` a declared relationship, `h:` a dependency that transitive reduction dropped and draws
 * as a hint. `toFlow` draws each edge under its id, and the layered layout routes it under the same id, so both build
 * ids here and nowhere else.
 *
 * graph.ts's `expansionKey` also uses `c:` and `p:`, for a table's children and parents. That namespace is the
 * expansion state, not edge ids, so it keeps its own prefixes.
 */

const COLUMN_PREFIX = "c:";

/** The id of the dbt table edge from `parent` to `child`. */
export const tableEdgeId = (parent: string, child: string): string =>
  `t:${parent}->${child}`;

/** The id of the group edge from `parent` to `child`, where a folder group stands for some of the neighbours. */
export const groupEdgeId = (parent: string, child: string): string =>
  `g:${parent}->${child}`;

/** The id of the hint drawn for the dependency from `parent` to `child` that transitive reduction dropped. */
export const hintEdgeId = (parent: string, child: string): string =>
  `h:${parent}->${child}`;

/** The id of the column edge from one `[table, column]` to another. */
export const columnEdgeId = (
  source: [table: string, column: string],
  target: [table: string, column: string],
): string => `${COLUMN_PREFIX}${source.join(".")}->${target.join(".")}`;

/** The id of the declared relationship `refId`. */
export const relationshipEdgeId = (refId: string): string => `r:${refId}`;

/** Whether an edge id belongs to a column edge. */
export const isColumnEdgeId = (id: string): boolean =>
  id.startsWith(COLUMN_PREFIX);

/** Whether a listed column is named `name`, ignoring case. */
export const sameColumnName = (
  column: Pick<lineage.LineageColumn, "name">,
  name: string,
): boolean => column.name.toLowerCase() === name.toLowerCase();
