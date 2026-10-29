/** Below this canvas size the minimap starts hidden; it would cover most of the graph. */
const MINIMAP_ROOMY = { width: 720, height: 360 };

interface Size {
  width: number;
  height: number;
}

/** The minimap's dimensions: a fifth of the canvas, kept between 120x80 and 200x150. */
export const minimapSize = (size: Size): Size => ({
  width: Math.round(Math.min(200, Math.max(120, size.width / 5))),
  height: Math.round(Math.min(150, Math.max(80, size.height / 5))),
});

/**
 * The user's choice once made; otherwise shown when the canvas is at least 720x360. An unmeasured canvas
 * (zero width) never shows it.
 */
export const minimapShown = (
  choice: boolean | undefined,
  size: Size,
): boolean =>
  (choice ??
    (size.width >= MINIMAP_ROOMY.width &&
      size.height >= MINIMAP_ROOMY.height)) &&
  size.width > 0;

/** Band nodes are the layer backdrop rather than cards, so the minimap leaves them out. */
export const minimapColour = (node: { type?: string | undefined }): string =>
  node.type === "band"
    ? "transparent"
    : "var(--vscode-editorWidget-border, var(--vscode-disabledForeground))";

export const minimapStroke = (node: { type?: string | undefined }): string =>
  node.type === "band" ? "transparent" : "var(--vscode-focusBorder)";
