/** Quotes a CSV field: text is wrapped in double quotes with embedded quotes doubled; null becomes empty. */
function csvField(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return `"${value.replace(/"/g, '""')}"`;
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return typeof value === "number" || typeof value === "boolean"
    ? value.toString()
    : JSON.stringify(value);
}

/** The result as CSV text with CRLF line ends. */
export function dataToCsv(
  columns: string[],
  rows: Record<string, unknown>[],
): string {
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((name) => csvField(row[name])).join(",")),
  ].join("\r\n");
}
