import { lineage } from "@fusion-power-user/webview-contract";
import type { ExtensionContextStore } from "../../extensionContext";

/** The workspace-state key of the Layout control. One setting for the workspace, whatever the start model. */
const LAYOUT_KEY = "lineage.layout";

type Store = Pick<
  ExtensionContextStore,
  "getFromWorkspaceState" | "setToWorkspaceState"
>;

/**
 * The Layout control in workspace state. Nothing stored means the default spacing; anything but `compact` reads as the
 * default, so a value this build does not know cannot break the panel.
 */
export function readLineageLayout(store: Store): lineage.LineageLayout {
  const stored = store.getFromWorkspaceState<
    Partial<Record<keyof lineage.LineageLayout, unknown>> | undefined
  >(LAYOUT_KEY);
  return {
    spacing:
      stored?.spacing === "compact"
        ? "compact"
        : lineage.DEFAULT_SPACING_PRESET,
  };
}

/** Saves `layout` as the workspace's Layout control. */
export function persistLineageLayout(
  store: Store,
  layout: lineage.LineageLayout,
): void {
  store.setToWorkspaceState(LAYOUT_KEY, { spacing: layout.spacing });
}
