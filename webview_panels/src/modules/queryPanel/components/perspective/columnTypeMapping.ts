import { TableData } from "@modules/queryPanel/context/types";
import type { ColumnType } from "@perspective-dev/client";

/**
 * Maps a known legacy agate type to a Perspective schema type.
 * @internal
 */
export const mapColumnType = (
  agateType: string | null | undefined,
): ColumnType => {
  switch (agateType) {
    case "Text":
      return "string";
    case "Integer":
      return "float";
    case "BigInteger":
      // JS numbers lose precision above 2^53; keep known big integers as strings.
      return "string";
    case "Number":
      return "float";
    case null:
    case undefined:
    default:
      return "string";
  }
};

const toText = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value.toString();
  }
  return JSON.stringify(value);
};

/**
 * Explicit Perspective schema plus rows that conform to it. A column whose type was not reported is `string`, and
 * its values are shown as text; types are never guessed from values.
 */
export function buildPerspectiveTableInit(
  columnNames: string[],
  columnTypes: (string | null | undefined)[],
  data: TableData,
): {
  schema: Record<string, ColumnType>;
  rows: Record<string, unknown>[];
  /** Result column order; an object's key order moves integer-like names first, so the schema cannot carry it. */
  columns: string[];
} {
  const rows = Array.isArray(data) ? data : [];
  const schema: Record<string, ColumnType> = {};
  columnNames.forEach((name, i) => {
    schema[name] = mapColumnType(columnTypes[i]);
  });
  return {
    schema,
    columns: [...columnNames],
    rows: rows.map((row) =>
      Object.fromEntries(
        columnNames.map((name) => [
          name,
          schema[name] === "string" ? toText(row[name]) : (row[name] ?? null),
        ]),
      ),
    ),
  };
}
