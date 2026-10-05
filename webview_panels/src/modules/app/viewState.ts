import { panelLogger } from "@modules/logger";
import { vscode } from "@modules/vscode";

/**
 * View state the documentation editor restores after VS Code rebuilds its page. `model` is the unique id of
 * the documented model; scroll and search apply only to that model at the same manifest publication.
 */
interface DocumentationEditorViewState {
  panel: "documentationEditor";
  publication?: string;
  model?: string;
  scrollTop: number;
  searchQuery: string;
}

/** View state the query results panel restores; `tabState` is the active title tab. */
interface QueryResultsViewState {
  panel: "queryResults";
  publication?: string;
  tabState: number;
}

/**
 * View state the lineage panel restores for the same starting table at the same publication. `expansions` replays
 * in order, each `c:<table>` (children) or `p:<table>` (parents); `columnTables` lists tables showing their columns;
 * `selectedColumn` is `[table, column]`.
 */
export interface LineageViewState {
  panel: "lineage";
  publication?: string;
  start?: string;
  expansions: string[];
  columnTables: string[];
  selectedTable?: string;
  selectedColumn?: string[];
}

/** What a panel may write through `vscode.setState`: view state only. */
export type PanelViewState =
  DocumentationEditorViewState | QueryResultsViewState | LineageViewState;

export type PanelName = PanelViewState["panel"];
type ViewStateOf<P extends PanelName> = Extract<PanelViewState, { panel: P }>;
type FieldKind = "number" | "string" | "strings";

/** Longest string a view state field may hold. */
export const MAX_VIEW_STATE_STRING = 200;

/**
 * Most entries a `strings` field may hold.
 * @internal
 */
export const MAX_VIEW_STATE_LIST = 200;

/**
 * Every key each panel may persist and its kind; `panel` is checked separately.
 * @internal
 */
export const VIEW_STATE_FIELDS: {
  [P in PanelName]: Record<Exclude<keyof ViewStateOf<P>, "panel">, FieldKind>;
} = {
  documentationEditor: {
    publication: "string",
    model: "string",
    scrollTop: "number",
    searchQuery: "string",
  },
  queryResults: { publication: "string", tabState: "number" },
  lineage: {
    publication: "string",
    start: "string",
    expansions: "strings",
    columnTables: "strings",
    selectedTable: "string",
    selectedColumn: "strings",
  },
};

const fitsString = (value: unknown): boolean =>
  typeof value === "string" && value.length <= MAX_VIEW_STATE_STRING;

const fitsKind = (kind: FieldKind, value: unknown): boolean => {
  switch (kind) {
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "string":
      return fitsString(value);
    case "strings":
      return (
        Array.isArray(value) &&
        value.length <= MAX_VIEW_STATE_LIST &&
        value.every(fitsString)
      );
  }
};

/**
 * True when `value` is a view state of `panel` holding only that panel's allowlisted fields.
 * @internal
 */
export const isViewState = <P extends PanelName>(
  panel: P,
  value: unknown,
): value is ViewStateOf<P> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.panel !== panel) {
    return false;
  }
  const fields = VIEW_STATE_FIELDS[panel] as Record<string, FieldKind>;
  return Object.entries(record).every(
    ([key, field]) =>
      key === "panel" ||
      field === undefined ||
      (key in fields && fitsKind(fields[key], field)),
  );
};

/** Writes `state` through `vscode.setState`; refuses, and logs, anything outside its panel's allowlist. */
export const writeViewState = (state: PanelViewState): boolean => {
  if (!isViewState(state.panel, state)) {
    panelLogger.error(
      "refused to persist a field outside the view state allowlist",
      Object.keys(state),
    );
    return false;
  }
  vscode.setState(state);
  return true;
};

/** The view state `panel` persisted before VS Code rebuilt its page; undefined when absent or invalid. */
export const readViewState = <P extends PanelName>(
  panel: P,
): ViewStateOf<P> | undefined => {
  const stored = vscode.getState();
  return isViewState(panel, stored) ? stored : undefined;
};
