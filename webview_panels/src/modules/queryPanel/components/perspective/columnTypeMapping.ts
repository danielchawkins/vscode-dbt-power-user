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

/**
 * dbt show --output json fabricates no column types, but its row values are real JSON:
 * numbers, booleans, strings, and null arrive typed. When every column's type is unknown,
 * hand Perspective the row data directly so it infers real types instead of forcing every
 * column into a string schema. When at least one column's type is known, build the explicit
 * schema so known types keep their mapping (including BigInteger's precision safeguard).
 */
export function buildPerspectiveTableInit(
  columnNames: string[],
  columnTypes: (string | null | undefined)[],
  data: TableData,
): TableData | Record<string, string> {
  const hasKnownType = columnTypes.some(
    (type) => type !== null && type !== undefined,
  );
  if (!hasKnownType) {
    return data;
  }
  const schema: Record<string, string> = {};
  for (let i = 0; i < columnNames.length; i++) {
    schema[columnNames[i]] = mapColumnType(columnTypes[i]);
  }
  return schema;
}
