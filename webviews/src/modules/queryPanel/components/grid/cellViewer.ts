/** What a decorated cell opens in the drawer. */
export type CellViewerKind = "json" | "string";

/** Approximate rendered width of one character, used to decide whether a string overflows its cell. */
const CHARACTER_WIDTH = 8;

const isJson = (text: string): boolean => {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null;
  } catch {
    return false;
  }
};

/**
 * Classifies a string cell: JSON objects and arrays open as JSON, overflowing text as a string, the rest not at all.
 */
export function cellViewerKind(
  value: string,
  cellWidth: number,
): CellViewerKind | undefined {
  if (isJson(value)) {
    return "json";
  }
  return cellWidth < CHARACTER_WIDTH * value.length ? "string" : undefined;
}

/** The drawer body for a cell: JSON pretty-printed, long text broken every 45 characters. */
export function cellViewerText(kind: CellViewerKind, value: string): string {
  if (kind === "json") {
    return JSON.stringify(JSON.parse(value), null, 2);
  }
  return value.match(/.{1,45}/g)?.join("\n") ?? value;
}
