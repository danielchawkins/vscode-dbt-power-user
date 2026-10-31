import type { lineage } from "@fusion-power-user/webview-contract";
import type { NeighbourGroups } from "./grouping";

type LineageTable = lineage.LineageTable;
type LineageColumn = lineage.LineageColumn;
type ColumnLineage = lineage.ColumnLineage;

/**
 * The lineage graph's types, in their own module so that the projection can read them without a cycle through
 * `graph.ts`, which re-exports them.
 */

/** Which neighbours of a table an expansion adds: its dbt children or its dbt parents. */
export type Direction = "children" | "parents";

/** An expansion as its direction and its table: the card whose neighbours it adds. */
export type Expansion = [direction: Direction, table: string];

/** A column as `[table unique ID, column name]`. */
export type TableColumn = [table: string, column: string];

/**
 * The lineage graph the panel draws. `known`, `neighbours` and `columns` cache host answers; the drawn graph is the
 * start table plus each entry of `expansions`, in order, whose table is drawn.
 */
/**
 * The Scope settings the projection and the layout read: the node types and the tags switched off, and the cards whose
 * edges are soft. The dimmed cards are not here: they restyle the built flow, so they never rebuild the graph.
 */
export type GraphScope = Pick<
  lineage.LineageScope,
  "offTypes" | "offTags" | "softened"
>;

export interface GraphState {
  start?: string | undefined;
  known: Record<string, LineageTable>;
  /** The neighbour IDs each expansion key added. */
  neighbours: Record<string, string[]>;
  /** Applied expansions, each `c:<table>` (children) or `p:<table>` (parents). */
  expansions: string[];
  columns: Record<string, LineageColumn[]>;
  /** Drawn tables that list their columns. */
  columnTables: string[];
  /** Column edges traced from `selectedColumn`. */
  columnEdges: ColumnLineage[];
  /**
   * The hidden cards of the workspace, whatever the start model. A hidden card, and each card drawn only through it, is
   * not drawn; a card that is not in this graph does nothing here, and is kept for the other models.
   */
  hiddenCards: lineage.HiddenCard[];
  /**
   * The node types and tags the Scope control switched off, whatever the start model. A card they remove is not drawn,
   * and neither is each card drawn only through it; the start card is never removed. A softened card stays drawn, and
   * its dependency edges are soft in the layout.
   */
  scope: GraphScope;
  /** Tooltip lines per table from the last trace. */
  errors: Record<string, string[]>;
  /** Collapse count per expansion key; an expansion whose count changed while fetching is dropped. */
  cancelled: Record<string, number>;
  /** Expansion keys whose neighbours are being fetched. */
  pending: string[];
  /**
   * Data-flow `[parent, child]` pairs the host reported among drawn tables, keyed `parent\0child`. They draw edges
   * between tables that are already drawn and never make a table drawn, so collapsing still removes what only an
   * expansion added.
   */
  links: Record<string, [string, string]>;
  /** How many of an expansion's neighbours are drawn, by key; a key without an entry draws them all. */
  shown: Record<string, number>;
  /** The most neighbours a new expansion draws at first; 0 draws all. */
  cap: number;
  /** How neighbours are bucketed once they outnumber `cap`. */
  groupBy: "none" | "folder";
  /** The buckets of each grouped expansion, by key; a grouped key has no `shown` entry. */
  groups: Record<string, NeighbourGroups>;
  /** The view the projection draws: the whole project, or the neighbourhood of the start card. */
  view: ViewSettings;
  /** Every table of the project graph, once the whole view has it; the whole view draws them. */
  project?: string[] | undefined;
  selectedTable?: string | undefined;
  selectedColumn?: TableColumn | undefined;
  /** The column trace in flight: its column and when it started, from which the pending badge counts seconds. */
  tracing?: { column: TableColumn; since: number } | undefined;
}

/** Reads and changes the latest graph; an async step reads after each answer, so it never applies a stale base. */

/** The view the projection draws, from the settings: see `GraphState.view`. */
export interface ViewSettings {
  viewMode: lineage.ViewMode;
  upstreamDepth: number;
  downstreamDepth: number;
  cardBudget: number;
}
