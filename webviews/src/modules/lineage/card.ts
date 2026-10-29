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

/** A file name without its directory and extension. */
function stem(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.[^.]+$/, "");
}

/** The source name in a source table's unique ID: `source.<package>.<source_name>.<table_name>`. */
function sourceNameOf(table: LineageTable): string | undefined {
  return table.nodeType === "source" ? table.table.split(".")[2] : undefined;
}

/**
 * The package a node belongs to: the package it reports, else the second segment of its unique ID
 * (`<resource_type>.<package>.<name>`), which metrics, exposures and functions carry without a package name.
 */
export function packageNameOf(table: LineageTable): string | undefined {
  return table.packageName ?? table.table.split(".")[1];
}

/**
 * The title in full. A model's label is its alias, which dbt sets to the file name when none is configured; a
 * source leads with its source name. Name mode titles by the dbt ref name where there is one.
 */
function cardName(table: LineageTable, mode: TitleMode): string {
  if (mode === "name" && table.refName) {
    return table.refName;
  }
  const source = sourceNameOf(table);
  return source ? `${source}.${table.label}` : table.label;
}

/** The card title for `mode`, shortened to fit: tighter when `zoomed`. */
export function cardTitle(
  table: LineageTable,
  mode: TitleMode,
  zoomed = false,
): string {
  return middleEllipsis(
    cardName(table, mode),
    zoomed ? ZOOMED_TITLE_MAX : TITLE_MAX,
  );
}

/**
 * The card's file line: the file name without its extension, or undefined when the node has no file or the file
 * name is already the title.
 */
export function cardFile(
  table: LineageTable,
  mode: TitleMode = "alias",
): string | undefined {
  if (!table.path) {
    return undefined;
  }
  const file = stem(table.path);
  return file === cardName(table, mode) ? undefined : file;
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

/**
 * The card's hover text. It carries what an unselected card leaves out: the alias when it differs from the file
 * name, the file path, the package and type, the `ref()` or `source()` call, and the relation.
 */
export function cardTooltip(table: LineageTable): string {
  const file = table.path ? stem(table.path) : undefined;
  const source = sourceNameOf(table);
  const relation = relationOf(table, table.schema);
  const pkg = packageNameOf(table);
  return [
    table.table,
    file !== undefined && table.label !== file
      ? `alias: ${table.label}`
      : undefined,
    table.path,
    pkg ? `${pkg}.${table.nodeType}` : table.nodeType,
    source
      ? `source('${source}', '${table.label}')`
      : table.path
        ? `ref('${table.refName ?? table.label}')`
        : undefined,
    relation
      ? `relation: ${relation}.${table.identifier ?? table.label}`
      : undefined,
    table.layer ? `${table.layer} layer` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}
