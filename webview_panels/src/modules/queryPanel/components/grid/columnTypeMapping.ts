import { TableData } from "@modules/queryPanel/context/types";

/** How the grid renders and sorts a column. */
export type GridColumnType = "string" | "number";

/**
 * Maps a known legacy agate type to a grid column type.
 * @internal
 */
export const mapColumnType = (
  agateType: string | null | undefined,
): GridColumnType => {
  // BigInteger stays a string: JS numbers lose precision above 2^53.
  return agateType === "Integer" || agateType === "Number"
    ? "number"
    : "string";
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
 * Explicit column types plus rows that conform to them. A column whose type was not reported is `string`, and
 * its values are shown as text; types are never guessed from values.
 */
export function buildGridInit(
  columnNames: string[],
  columnTypes: (string | null | undefined)[],
  data: TableData,
): {
  schema: Record<string, GridColumnType>;
  rows: Record<string, unknown>[];
  /** Result column order; an object's key order moves integer-like names first, so the schema cannot carry it. */
  columns: string[];
} {
  const rows = Array.isArray(data) ? data : [];
  const schema: Record<string, GridColumnType> = {};
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

/** The text a cell shows: numbers keep every digit and no grouping, missing values are empty. */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number") {
    return value.toLocaleString("en-US", {
      useGrouping: false,
      maximumFractionDigits: 20,
    });
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}
