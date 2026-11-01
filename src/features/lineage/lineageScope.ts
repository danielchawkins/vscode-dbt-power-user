import type { lineage } from "@fusion-power-user/webview-contract";
import type { ExtensionContextStore } from "../../extensionContext";

/** The workspace-state key of the scope. One scope for the workspace, whatever the start model. */
const SCOPE_KEY = "lineage.scope";

type Store = Pick<
  ExtensionContextStore,
  "getFromWorkspaceState" | "setToWorkspaceState"
>;

/** The strings of `value`, each once and in order; anything that is not a string is dropped. */
const names = (value: unknown): string[] => [
  ...new Set(
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [],
  ),
];

/**
 * The scope in workspace state. Nothing stored means nothing switched off, softened or dimmed; a scope stored before the
 * busy-node list existed has no softened or dimmed cards, one stored before the edge groups has none switched off, and
 * one stored before transitive reduction has it off.
 */
export function readLineageScope(store: Store): lineage.LineageScope {
  const stored = store.getFromWorkspaceState<
    Partial<Record<keyof lineage.LineageScope, unknown>> | undefined
  >(SCOPE_KEY);
  return {
    offTypes: names(stored?.offTypes),
    offTags: names(stored?.offTags),
    softened: names(stored?.softened),
    dimmed: names(stored?.dimmed),
    offEdgeGroups: names(stored?.offEdgeGroups),
    transitiveReduction: stored?.transitiveReduction === true,
  };
}

/** Saves `scope` as the workspace's scope, each name once. */
export function persistLineageScope(
  store: Store,
  scope: lineage.LineageScope,
): void {
  store.setToWorkspaceState(SCOPE_KEY, {
    offTypes: names(scope.offTypes),
    offTags: names(scope.offTags),
    softened: names(scope.softened),
    dimmed: names(scope.dimmed),
    offEdgeGroups: names(scope.offEdgeGroups),
    transitiveReduction: scope.transitiveReduction,
  });
}
