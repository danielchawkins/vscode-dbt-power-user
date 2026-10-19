import type { lineage } from "@fusion-power-user/webview-contract";

type LineageTable = lineage.LineageTable;

/** Characters a card title shows before it is shortened; a 280px card fits about this many at 13px. */
export const TITLE_MAX = 30;

/**
 * `text` shortened to `max` characters with an ellipsis in the middle, keeping about a third of the room for the
 * start and the rest for the end. dbt names put what tells them apart at the end (`stg_<source>__<entity>`), and
 * CSS can only cut the end.
 */
export function middleEllipsis(text: string, max: number): string {
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

/**
 * A card's second line: the relation first, then the materialization, then the package when it is not the
 * project's own. Every part comes from the node itself, so a card never changes when another node is drawn.
 */
export function cardSubtitle(table: LineageTable): string {
  const parts = [
    relationOf(table, shownSchema(table)),
    table.materialization,
    table.rootPackage ? undefined : table.packageName,
  ];
  return parts.filter(Boolean).join(" · ");
}

/** The card badge: the node's layer when known, otherwise its resource type. */
export const cardBadge = (table: LineageTable): string =>
  table.layer ?? table.nodeType;

/** The card's hover text: the unique ID, the ref name when it differs, and the relation. */
export function cardTooltip(table: LineageTable): string {
  const relation = relationOf(table, table.schema);
  return [
    table.table,
    table.refName ? `ref: ${table.refName}` : undefined,
    relation ? `relation: ${relation}.${table.label}` : undefined,
    table.layer ? `${table.nodeType}, ${table.layer} layer` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}
