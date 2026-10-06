import { typedReducer } from "@modules/app/typedReducer";
import {
  isStateDirty,
  mergeCurrentAndIncomingDocumentationColumns,
} from "../utils";
import {
  DBTDocumentation,
  DBTModelTest,
  DBTUnitTest,
  DocumentationStateProps,
  MetadataColumn,
} from "./types";

type S = DocumentationStateProps;

export const initialState: S = {
  incomingDocsData: undefined,
  currentDocsData: undefined,
  currentDocsTests: undefined,
  // Note: intentionally excluded from isStateDirty — Unit Tests UI is currently
  // read-only. Revisit if unit tests become editable.
  currentUnitTests: undefined,
  project: undefined,
  missingDocumentationMessage: undefined,
  searchQuery: "",
  docBlocks: [],
};

const set =
  <K extends keyof S>(key: K) =>
  (state: S, value: S[K]): S => ({ ...state, [key]: value });

const takeIncomingDocs = (
  state: S,
  payload:
    | {
        docs?: DBTDocumentation | undefined;
        tests?: DBTModelTest[] | undefined;
        unitTests?: DBTUnitTest[] | undefined;
      }
    | undefined,
): S => {
  const incomingDocsData = payload ?? {};
  // A first load, or a form without edits, takes the incoming data; otherwise the editor keeps its edits.
  if (!state.currentDocsData || !isStateDirty(state)) {
    return {
      ...state,
      docBlocks: [],
      incomingDocsData,
      currentDocsData: payload?.docs,
      currentDocsTests: payload?.tests,
      currentUnitTests: payload?.unitTests,
    };
  }
  return { ...state, docBlocks: [], incomingDocsData };
};

const mergeCurrentDocs = (
  state: S,
  payload: Partial<DBTDocumentation> | undefined,
): S => {
  // A YAML file sends `{}`.
  if (!payload || !Object.keys(payload).length) {
    return { ...state, currentDocsData: undefined };
  }
  if (!payload.name) {
    return state;
  }
  if (state.currentDocsData?.name !== payload.name) {
    return { ...state, currentDocsData: payload as DBTDocumentation };
  }
  return {
    ...state,
    currentDocsData: { ...state.currentDocsData, ...payload },
  };
};

const withColumns = (
  state: S,
  columns: (
    current: DBTDocumentation["columns"],
  ) => DBTDocumentation["columns"],
): S =>
  state.currentDocsData
    ? {
        ...state,
        currentDocsData: {
          ...state.currentDocsData,
          columns: columns(state.currentDocsData.columns),
        },
      }
    : state;

const documentation = typedReducer<
  S,
  {
    setSearchQuery: S["searchQuery"];
    setMissingDocumentationMessage: S["missingDocumentationMessage"];
    setProject: S["project"];
    setDocBlocks: S["docBlocks"];
    setPublication: S["publication"];
    updateCurrentDocsTests: S["currentDocsTests"];
    updateCurrentUnitTests: S["currentUnitTests"];
    setIncomingDocsData: Parameters<typeof takeIncomingDocs>[1];
    updateCurrentDocsData: Parameters<typeof mergeCurrentDocs>[1];
    updateColumnsAfterSync: { columns: DBTDocumentation["columns"] };
    updateColumnsInCurrentDocsData: {
      columns: Partial<MetadataColumn & { description?: string }>[];
    };
  }
>({
  setSearchQuery: set("searchQuery"),
  setMissingDocumentationMessage: set("missingDocumentationMessage"),
  setProject: (state, project) => ({ ...state, project, docBlocks: [] }),
  setDocBlocks: set("docBlocks"),
  setPublication: set("publication"),
  updateCurrentDocsTests: set("currentDocsTests"),
  updateCurrentUnitTests: set("currentUnitTests"),
  setIncomingDocsData: takeIncomingDocs,
  updateCurrentDocsData: mergeCurrentDocs,
  updateColumnsAfterSync: (state, { columns }) =>
    withColumns(state, (current) =>
      mergeCurrentAndIncomingDocumentationColumns(current, columns),
    ),
  updateColumnsInCurrentDocsData: (state, { columns }) =>
    withColumns(state, (current) =>
      current.map((c) => {
        const updatedColumn = columns.find((column) => c.name === column.name);
        return updatedColumn ? { ...c, ...updatedColumn } : c;
      }),
    ),
});

export const documentationReducer = documentation.reducer;
export type DocumentationAction = Parameters<typeof documentationReducer>[1];
export const {
  setIncomingDocsData,
  updateCurrentDocsData,
  updateColumnsInCurrentDocsData,
  updateColumnsAfterSync,
  setProject,
  setDocBlocks,
  setPublication,
  updateCurrentDocsTests,
  updateCurrentUnitTests,
  setMissingDocumentationMessage,
  setSearchQuery,
} = documentation.actions;
