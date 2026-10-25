/**
 * Layer tags and band colours for the lineage layouts: which band a node sits in, and the CSS colour each band draws.
 *
 * Colours come from the theme's charts palette unless `lineage.layerColors` overrides them.
 */

const SOURCE_TAG = "source";
export const OTHER_TAG = "other";
const LAYER_ORDER = ["source", "staging", "intermediate", "marts"];

/** The band tag for a node: sources and seeds share the source band, untagged nodes go to Other. */
export function layerTagOf(
  nodeType: string,
  layer: string | undefined,
): string {
  if (nodeType === "source" || nodeType === "seed") {
    return SOURCE_TAG;
  }
  return layer && layer.length > 0 ? layer : OTHER_TAG;
}

/** A theme colour id such as `charts.red` or `terminal.ansiCyan`: dotted words, as VS Code names its colours. */
const THEME_COLOUR = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;
/** A CSS colour this setting accepts: hex, or an rgb/hsl/oklch-style function. Anything else is ignored. */
const CSS_COLOUR =
  /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\([^;{}]*\))$/;

/**
 * The CSS colour of one `lineage.layerColors` entry: a theme colour id becomes its `--vscode-*` variable, so it
 * follows the theme; a hex or colour function is used as written. `undefined` for anything else.
 */
function layerColourValue(value: string): string | undefined {
  const trimmed = value.trim();
  if (THEME_COLOUR.test(trimmed)) {
    return `var(--vscode-${trimmed.replaceAll(".", "-")})`;
  }
  return CSS_COLOUR.test(trimmed) ? trimmed : undefined;
}

/**
 * The CSS colour a band and card stripe of this tag use: the `overrides` entry for the tag when it is a usable
 * colour, else the theme's charts palette. Tags compare case-insensitively.
 */
export function bandColour(
  tag: string,
  overrides?: Readonly<Record<string, string>>,
): string {
  const key = tag.toLowerCase();
  const entry = Object.entries(overrides ?? {}).find(
    ([name]) => name.toLowerCase() === key,
  )?.[1];
  const custom = entry === undefined ? undefined : layerColourValue(entry);
  return custom ?? defaultBandColour(tag);
}

/** The theme charts colour of each well-known layer; other layers use yellow and Other the muted foreground. */
function defaultBandColour(tag: string): string {
  switch (tag) {
    case "source":
      return "var(--vscode-charts-orange)";
    case "staging":
      return "var(--vscode-charts-blue)";
    case "intermediate":
      return "var(--vscode-charts-purple)";
    case "marts":
      return "var(--vscode-charts-green)";
    case OTHER_TAG:
      return "var(--vscode-descriptionForeground)";
    default:
      return "var(--vscode-charts-yellow)";
  }
}

/** Position of a tag in the layer order; tags outside it rank after every listed layer. */
export const tagRank = (tag: string): number => {
  const rank = LAYER_ORDER.indexOf(tag);
  return rank < 0 ? LAYER_ORDER.length : rank;
};

/** The tag most of `tags` carry; a tie goes to the earlier layer, so a group's band is its upstream-most layer. */
export function dominantTag(tags: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const tag of tags) {
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const ranked = [...counts].sort(
    ([p, a], [q, b]) => b - a || tagRank(p) - tagRank(q) || (p < q ? -1 : 1),
  );
  return ranked[0]?.[0] ?? OTHER_TAG;
}
