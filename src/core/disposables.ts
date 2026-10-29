/**
 * Disposes every item of `items`, last-registered first, and empties the list, so a second call disposes nothing.
 * An `undefined` entry is skipped. The parameter is structural, so core stays free of the VS Code API.
 */
export function disposeAll(
  items: ({ dispose(): unknown } | undefined)[],
): void {
  for (const item of items.splice(0).reverse()) {
    item?.dispose();
  }
}
