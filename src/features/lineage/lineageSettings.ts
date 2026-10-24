import type { lineage } from "@fusion-power-user/webview-contract";
import type { ExtensionContextStore } from "../../extensionContext";
import { readSetting, writeSetting } from "../../settings";

/** The global-state key of the lineage view settings other than `defaultExpansion`, which is a user setting. */
const LINEAGE_SETTINGS_KEY = "lineage.viewSettings";

type StoredLineageSettings = Omit<
  Partial<lineage.LineageSettings>,
  | "defaultExpansion"
  | "maxNeighbours"
  | "groupBy"
  | "layout"
  | "semanticZoom"
  | "title"
  | "layerColors"
>;

/** What global state may hold: `showRefs` is the overlay toggle that `connections` replaced, kept for old stores. */
type StoredView = Partial<lineage.LineageSettings> & { showRefs?: boolean };

/** Every key `storedLineageSettings` keeps; the record type makes a new `LineageSettings` key a compile error here. */
const STORED_KEYS: Record<keyof StoredLineageSettings, true> = {
  showSelectEdges: true,
  showNonSelectEdges: true,
  connections: true,
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
  const { showRefs, ...stored } =
    store.getFromGlobalState<StoredView>(LINEAGE_SETTINGS_KEY) ?? {};
  return {
    showSelectEdges: true,
    showNonSelectEdges: false,
    ...stored,
    // A store written before `connections` carries only the old overlay toggle: on means both, off means dbt.
    connections: stored.connections ?? (showRefs === true ? "both" : "dbt"),
    defaultExpansion: Math.min(readSetting("lineage.defaultExpansion"), 5),
    maxNeighbours: Math.max(
      0,
      Math.trunc(readSetting("lineage.maxNeighbours") ?? 20),
    ),
    groupBy: readSetting("lineage.groupBy") === "none" ? "none" : "folder",
    layout:
      readSetting("lineage.layout") === "leftToRight"
        ? "leftToRight"
        : "layered",
    semanticZoom: readSetting("lineage.semanticZoom") !== false,
    title: readSetting("lineage.title") === "name" ? "name" : "alias",
    layerColors: layerColorsSetting(),
  };
}

/** The `lineage.layerColors` entries whose key and value are both non-empty strings; the panel validates colours. */
function layerColorsSetting(): Record<string, string> {
  const raw: unknown = readSetting("lineage.layerColors");
  if (typeof raw !== "object" || raw === null) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(raw).filter(
      (entry): entry is [string, string] =>
        entry[0] !== "" && typeof entry[1] === "string" && entry[1] !== "",
    ),
  );
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
