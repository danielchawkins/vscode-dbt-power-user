/** A dbt project layer: the conventional `staging`, `intermediate` and `marts`, or a custom one from a tag. */
export type ModelLayer = string;

const FOLDER_LAYERS: Readonly<Record<string, ModelLayer>> = {
  staging: "staging",
  intermediate: "intermediate",
  marts: "marts",
  mart: "marts",
};

const PREFIX_LAYERS: readonly [prefix: string, layer: ModelLayer][] = [
  ["stg_", "staging"],
  ["int_", "intermediate"],
  ["fct_", "marts"],
  ["dim_", "marts"],
];

/** What `inferLayer` reads for one node. */
export interface LayerInputs {
  /** The node's tags; one starting with `tagPrefix` names the layer. */
  tags?: readonly string[] | undefined;
  /** The node's path relative to the project; a `staging`, `intermediate` or `marts` folder names the layer. */
  path?: string | undefined;
  /** The node's name; a `stg_`, `int_`, `fct_` or `dim_` prefix names the layer. */
  name?: string | undefined;
}

/**
 * The node's layer: from a tag with `tagPrefix` (an empty prefix turns tags off), then from a folder in its path when
 * `fromPath` is set, then from its name prefix when `fromPath` is set. Undefined when none applies. This follows dbt
 * Catalog's layer inference, with a tag able to override it.
 */
export function inferLayer(
  node: LayerInputs,
  options: { tagPrefix: string; fromPath: boolean },
): ModelLayer | undefined {
  const { tagPrefix, fromPath } = options;
  if (tagPrefix) {
    const tag = node.tags?.find(
      (t) => t.startsWith(tagPrefix) && t.length > tagPrefix.length,
    );
    if (tag) {
      return tag.slice(tagPrefix.length);
    }
  }
  if (!fromPath) {
    return undefined;
  }
  const folders = (node.path ?? "").split(/[\\/]/).slice(0, -1);
  for (const folder of folders.toReversed()) {
    // Numbered layer folders (`13_staging`, `21_intermediate`) keep their order on disk.
    const layer = FOLDER_LAYERS[folder.toLowerCase().replace(/^\d+[_-]/, "")];
    if (layer) {
      return layer;
    }
  }
  const name = node.name?.toLowerCase() ?? "";
  return PREFIX_LAYERS.find(([prefix]) => name.startsWith(prefix))?.[1];
}
