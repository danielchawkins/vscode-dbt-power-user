// Copy of webview_panels/src/modules/queryPanel/components/perspective/columnTypeMapping.ts, untyped.
const mapColumnType = (agateType) => {
  switch (agateType) {
    case "Text":
      return "string";
    case "Integer":
      return "float";
    case "BigInteger":
      return "string";
    case "Number":
      return "float";
    default:
      return "string";
  }
};

const toText = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value.toString();
  }
  return JSON.stringify(value);
};

export function buildPerspectiveTableInit(columnNames, columnTypes, data) {
  const schema = {};
  columnNames.forEach((name, i) => {
    schema[name] = mapColumnType(columnTypes[i]);
  });
  return {
    schema,
    columns: [...columnNames],
    rows: data.map((row) =>
      Object.fromEntries(
        columnNames.map((name) => [name, schema[name] === "string" ? toText(row[name]) : (row[name] ?? null)]),
      ),
    ),
  };
}
