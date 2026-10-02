import { panelLogger } from "@modules/logger";
import { vscode } from "@modules/vscode";

/**
 * View state the documentation editor restores after VS Code rebuilds its page. `model` is the unique id of
 * the documented model; scroll and search apply only to that model at the same manifest publication.
 */
export interface DocumentationEditorViewState {
  panel: "documentationEditor";
  publication?: string;
  model?: string;
  scrollTop: number;
  searchQuery: string;
}

/** View state the query results panel restores; `tabState` is the active title tab. */
export interface QueryResultsViewState {
  panel: "queryResults";
  publication?: string;
  tabState: number;
}

/** What a panel may write through `vscode.setState`: view state only. */
export type PanelViewState =
  DocumentationEditorViewState | QueryResultsViewState;

export type PanelName = PanelViewState["panel"];
type ViewStateOf<P extends PanelName> = Extract<PanelViewState, { panel: P }>;
type FieldKind = "number" | "string";

/** Longest string a view state field may hold. */
export const MAX_VIEW_STATE_STRING = 200;

/** Every key each panel may persist and its kind; `panel` is checked separately. */
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
};

const fitsKind = (kind: FieldKind, value: unknown): boolean =>
  kind === "number"
    ? typeof value === "number" && Number.isFinite(value)
    : typeof value === "string" && value.length <= MAX_VIEW_STATE_STRING;

/** True when `value` is a view state of `panel` holding only that panel's allowlisted fields. */
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
