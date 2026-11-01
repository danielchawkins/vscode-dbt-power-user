import { lineage } from "@fusion-power-user/webview-contract";
import { panelLogger } from "@modules/logger";
import { useCallback, useEffect, useState } from "react";
import { fetchLineageLayout, persistLineageLayout } from "./requests";

/** The Layout control the host kept for the workspace: its spacing, and whether the stored one has arrived. */
export interface LayoutControl {
  /** False until the stored Layout control arrives; the graph is held until then. */
  loaded: boolean;
  spacing: lineage.SpacingPreset;
  /** Applies a new spacing at once and persists it; the graph is laid out again, and nothing else is fetched. */
  setSpacing: (spacing: lineage.SpacingPreset) => void;
}

/**
 * The Layout control the host kept for the workspace. A failed read keeps the default spacing. A change is applied at
 * once and persisted, as a Scope change is.
 */
export const useStoredLayout = (): LayoutControl => {
  const [stored, setStored] = useState<lineage.LineageLayout>();
  useEffect(() => {
    fetchLineageLayout().then(setStored, (error) => {
      panelLogger.error("lineage layout", error);
      setStored({ spacing: lineage.DEFAULT_SPACING_PRESET });
    });
  }, []);
  const setSpacing = useCallback((spacing: lineage.SpacingPreset) => {
    setStored({ spacing });
    persistLineageLayout({ spacing });
  }, []);
  return {
    loaded: stored !== undefined,
    spacing: stored?.spacing ?? lineage.DEFAULT_SPACING_PRESET,
    setSpacing,
  };
};
