import { lineage } from "@fusion-power-user/webview-contract";
import type { ExtensionContextStore } from "../../extensionContext";
import { readSetting, writeSetting } from "../../settings";

/** The global-state key of the lineage view settings other than `defaultExpansion`, which is a user setting. */
const LINEAGE_SETTINGS_KEY = "lineage.viewSettings";

type StoredLineageSettings = Omit<
  Partial<lineage.LineageSettings>,
  "defaultExpansion"
>;

/** Every key `storedLineageSettings` keeps; the record type makes a new `LineageSettings` key a compile error here. */
const STORED_KEYS: Record<keyof StoredLineageSettings, true> = {
  showSelectEdges: true,
  showNonSelectEdges: true,
  showRefs: true,
  enabledRefSources: true,
  inferenceConfidenceThreshold: true,
  includeSourcesInInference: true,
};

/** The known view settings in `params`, with the confidence threshold clamped to 0..1; other keys are dropped. */
function storedLineageSettings(
  params: Partial<lineage.LineageSettings>,
): StoredLineageSettings {
  const stored: Record<string, unknown> = {};
  for (const key of Object.keys(
    STORED_KEYS,
  ) as (keyof StoredLineageSettings)[]) {
    if (params[key] !== undefined) {
      stored[key] = params[key];
    }
  }
  const threshold = params.inferenceConfidenceThreshold;
  if (threshold !== undefined) {
    if (Number.isFinite(threshold)) {
      stored.inferenceConfidenceThreshold = Math.min(1, Math.max(0, threshold));
    } else {
      delete stored.inferenceConfidenceThreshold;
    }
  }
  return stored;
}

type Store = Pick<
  ExtensionContextStore,
  "getFromGlobalState" | "setToGlobalState"
>;

/** The lineage view settings: the stored view settings over the defaults, and the capped user setting. */
export function readLineageSettings(store: Store): lineage.LineageSettings {
  const stored =
    store.getFromGlobalState<Partial<lineage.LineageSettings>>(
      LINEAGE_SETTINGS_KEY,
    ) ?? {};
  return {
    showSelectEdges: true,
    showNonSelectEdges: false,
    ...stored,
    defaultExpansion: Math.min(readSetting("lineage.defaultExpansion"), 5),
  };
}

/** Saves `defaultExpansion` as the user setting and every other known key in global state. */
export async function persistLineageSettings(
  store: Store,
  { defaultExpansion, ...params }: Partial<lineage.LineageSettings>,
): Promise<void> {
  if (defaultExpansion !== undefined) {
    await writeSetting("lineage.defaultExpansion", defaultExpansion);
  }
  const view = storedLineageSettings(params);
  if (Object.keys(view).length > 0) {
    const stored =
      store.getFromGlobalState<StoredLineageSettings>(LINEAGE_SETTINGS_KEY) ??
      {};
    store.setToGlobalState(LINEAGE_SETTINGS_KEY, { ...stored, ...view });
  }
}
