import type { lineage } from "@fusion-power-user/webview-contract";

type LineageTable = lineage.LineageTable;

/** Characters a card title shows before it is shortened; a 280px card fits about this many at 13px. */
const TITLE_MAX = 30;

/** Characters a zoomed-out card title shows; the larger type fits fewer in the same 280px. */
const ZOOMED_TITLE_MAX = 15;

/**
 * `text` shortened to `max` characters with an ellipsis in the middle, keeping about a third of the room for the
 * start and the rest for the end. dbt names put what tells them apart at the end (`stg_<source>__<entity>`), and
 * CSS can only cut the end.
 */
function middleEllipsis(text: string, max: number): string {
  if (text.length <= max || max < 5) {
    return text;
  }
  const room = max - 1;
  const head = Math.ceil(room / 3);
  return `${text.slice(0, head)}…${text.slice(text.length - (room - head))}`;
}

/**
 * The schema a card shows: the custom schema when the node's schema ends with `_<customSchema>` (dbt's default
 * `generate_schema_name` prefixes the target schema), otherwise the schema unchanged. Case-insensitive, as
 * Snowflake upper-cases names.
 */
function shownSchema(table: LineageTable): string | undefined {
  const { schema, customSchema } = table;
  if (!schema || !customSchema) {
    return schema;
  }
  return schema.toLowerCase().endsWith(`_${customSchema.toLowerCase()}`)
    ? customSchema
    : schema;
}

/** Where the node is built: `database.schema`, or undefined when it builds no relation. */
function relationOf(
  table: LineageTable,
  schema: string | undefined,
): string | undefined {
  if (!schema) {
    return undefined;
  }
  return table.database ? `${table.database}.${schema}` : schema;
}

/** What titles a card: the built relation's name (`alias`) or the dbt name `ref()` uses (`name`). */
export type TitleMode = "alias" | "name";

/** The card title for `mode`, shortened to fit: tighter when `zoomed`. */
export function cardTitle(
  table: LineageTable,
  mode: TitleMode,
  zoomed = false,
): string {
  const title = mode === "name" ? (table.refName ?? table.label) : table.label;
  return middleEllipsis(title, zoomed ? ZOOMED_TITLE_MAX : TITLE_MAX);
}

/**
 * A card's second line: the relation first, then the materialization, then the package when it is not the
 * project's own. Every part comes from the node itself, so a card never changes when another node is drawn.
 * In name mode the title is the dbt name, so the relation line ends with the alias.
 */
export function cardSubtitle(
  table: LineageTable,
  mode: TitleMode = "alias",
): string {
  const relation = relationOf(table, shownSchema(table));
  const named = mode === "name" && table.refName;
  const parts = [
    relation && named
      ? `${relation}.${table.identifier ?? table.label}`
      : relation,
    table.materialization,
    table.rootPackage ? undefined : table.packageName,
  ];
  return parts.filter(Boolean).join(" · ");
}

/** The card badge: the node's layer when known, otherwise its resource type. */
export const cardBadge = (table: LineageTable): string =>
  table.layer ?? table.nodeType;

/**
 * The card's hover text: the unique ID, the ref name (the alias in name mode) when it differs, and the relation.
 */
export function cardTooltip(
  table: LineageTable,
  mode: TitleMode = "alias",
): string {
  const relation = relationOf(table, table.schema);
  const other =
    mode === "name"
      ? `alias: ${table.identifier ?? table.label}`
      : `ref: ${table.refName}`;
  return [
    table.table,
    table.refName ? other : undefined,
    relation
      ? `relation: ${relation}.${table.identifier ?? table.label}`
      : undefined,
    table.layer ? `${table.nodeType}, ${table.layer} layer` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}
