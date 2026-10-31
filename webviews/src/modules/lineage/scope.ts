import type { lineage } from "@fusion-power-user/webview-contract";
import type { GraphScope } from "./graphState";

/**
 * The Scope filters: which cards the node types and tags switched off remove. The projection reads `removedByScope`,
 * and the Scope control lists the choices `scopeChoices` finds in the project.
 */

/**
 * Whether the switched-off types and tags remove `table`: its type is off, or it has tags and every one of them is off.
 * An untagged card follows its type only.
 */
export const removedByScope = (
  table: lineage.LineageTable,
  scope: GraphScope,
): boolean => {
  if (scope.offTypes.includes(table.nodeType)) {
    return true;
  }
  const tags = table.tags ?? [];
  return tags.length > 0 && tags.every((tag) => scope.offTags.includes(tag));
};

/** The node types and the tags `tables` carry, each once and sorted: the choices the Scope control lists. */
export const scopeChoices = (
  tables: readonly lineage.LineageTable[],
): { types: string[]; tags: string[] } => ({
  types: [...new Set(tables.map((table) => table.nodeType))].sort(),
  tags: [...new Set(tables.flatMap((table) => table.tags ?? []))].sort(),
});

/**
 * `names`, the switched-off types or tags, with `name` switched on (removed from them) or off (added to them); each name
 * once.
 */
export const withName = (
  names: readonly string[],
  name: string,
  on: boolean,
): string[] => {
  if (on) {
    return names.filter((entry) => entry !== name);
  }
  return names.includes(name) ? [...names] : [...names, name];
};
