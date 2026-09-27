import { TableData } from "@modules/queryPanel/context/types";

/** Maps a known legacy agate type to a Perspective schema type. */
export const mapColumnType = (agateType: string | null | undefined): string => {
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
): { schema: Record<string, string>; rows: Record<string, unknown>[] } {
  const rows = Array.isArray(data) ? data : [];
  const schema: Record<string, string> = {};
  columnNames.forEach((name, i) => {
    schema[name] = mapColumnType(columnTypes[i]);
  });
  return {
    schema,
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
