import { lineage } from "@fusion-power-user/webview-contract";
import type { ExtensionContextStore } from "../../extensionContext";
import { readSetting, writeSetting } from "../../settings";

/** The global-state key of the lineage view settings other than `defaultExpansion`, which is a user setting. */
const LINEAGE_SETTINGS_KEY = "lineage.viewSettings";

type StoredLineageSettings = Omit<
  Partial<lineage.LineageSettings>,
  | "defaultExpansion"
  | "maxNeighbours"
  | "groupBy"
  | "engine"
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
  pathHighlight: true,
  dimOffPath: true,
  hubDeemphasis: true,
  edgeOpacity: true,
  viewMode: true,
  upstreamDepth: true,
  downstreamDepth: true,
  cardBudget: true,
};

/** The known view settings in `params`, with the confidence threshold clamped to 0..1 and edge opacity to 0.1..1; other keys are dropped. */
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
  const opacity = params.edgeOpacity;
  if (opacity !== undefined) {
    if (Number.isFinite(opacity)) {
      stored.edgeOpacity = Math.min(1, Math.max(0.1, opacity));
    } else {
      delete stored.edgeOpacity;
    }
  }
  for (const key of SCOPE_KEYS) {
    delete stored[key];
  }
  return { ...stored, ...scopeSettings(params) };
}

/** The keys `scopeSettings` checks; a stored value under one of them is replaced by its checked form, or dropped. */
const SCOPE_KEYS = [
  "viewMode",
  "upstreamDepth",
  "downstreamDepth",
  "cardBudget",
] as const;

/**
 * The neighbourhood and whole-project view settings in `params`, checked: depths rounded and clamped to
 * 0..`MAX_VIEW_DEPTH`, the card budget to 1..`MAX_CARD_BUDGET`; an unknown `viewMode` or a non-finite number is
 * left out. The keys of `SCOPE_KEYS` are always absent from the result unless valid.
 */
function scopeSettings(
  params: Partial<lineage.LineageSettings>,
): Partial<lineage.LineageSettings> {
  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, Math.round(value)));
  const depth = (value: number | undefined, out: "up" | "down") => {
    if (value === undefined || !Number.isFinite(value)) {
      return {};
    }
    return out === "up"
      ? { upstreamDepth: clamp(value, 0, lineage.MAX_VIEW_DEPTH) }
      : { downstreamDepth: clamp(value, 0, lineage.MAX_VIEW_DEPTH) };
  };
  const budget =
    params.cardBudget !== undefined && Number.isFinite(params.cardBudget)
      ? { cardBudget: clamp(params.cardBudget, 1, lineage.MAX_CARD_BUDGET) }
      : {};
  const mode =
    params.viewMode === "whole" || params.viewMode === "neighbourhood"
      ? { viewMode: params.viewMode }
      : {};
  return {
    ...mode,
    ...depth(params.upstreamDepth, "up"),
    ...depth(params.downstreamDepth, "down"),
    ...budget,
  };
}

/** `settings` with the `SCOPE_KEYS` removed, so that `scopeSettings` decides what they are. */
function withoutScopeKeys(
  settings: Partial<lineage.LineageSettings>,
): Partial<lineage.LineageSettings> {
  const rest: Partial<lineage.LineageSettings> = { ...settings };
  for (const key of SCOPE_KEYS) {
    delete rest[key];
  }
  return rest;
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
    ...withoutScopeKeys(stored),
    ...scopeSettings(stored),
    // A store written before `connections` carries only the old overlay toggle: on means both, off means dbt.
    connections: stored.connections ?? (showRefs === true ? "both" : "dbt"),
    defaultExpansion: Math.min(readSetting("lineage.defaultExpansion"), 5),
    maxNeighbours: Math.max(
      0,
      Math.trunc(readSetting("lineage.maxNeighbours") ?? 20),
    ),
    groupBy: readSetting("lineage.groupBy") === "none" ? "none" : "folder",
    engine: lineageEngineSetting(),
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

const ENGINES: readonly lineage.LineageEngine[] = [
  "rust-balanced",
  "rust-thorough",
  "balanced",
  "thorough",
];

/** `lineage.engine` as a known engine; anything else is the default. */
function lineageEngineSetting(): lineage.LineageEngine {
  const value = readSetting("lineage.engine");
  return (
    ENGINES.find((engine) => engine === value) ?? lineage.DEFAULT_LINEAGE_ENGINE
  );
}
