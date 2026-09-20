import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { isStateDirty, mergeCurrentAndIncomingDocumentationColumns } from "../utils";
import {
  DBTDocumentation,
  DBTModelTest,
  DBTUnitTest,
  DocumentationStateProps,
  MetadataColumn,
} from "./types";

export const initialState = {
  incomingDocsData: undefined,
  currentDocsData: undefined,
  currentDocsTests: undefined,
  // Note: intentionally excluded from isStateDirty — Unit Tests UI is currently
  // read-only. Revisit if unit tests become editable.
  currentUnitTests: undefined,
  project: undefined,
  insertedEntityName: undefined,
  missingDocumentationMessage: undefined,
  searchQuery: "",
  showSingleDocsPropRightPanel: false,
  showBulkDocsPropRightPanel: false,
  docBlocks: [],
} as DocumentationStateProps;

const documentationSlice = createSlice({
  name: "documentationState",
  initialState,
  reducers: {
    setSearchQuery: (state, action: PayloadAction<DocumentationStateProps["searchQuery"]>) => {
      state.searchQuery = action.payload;
    },
    setMissingDocumentationMessage: (
      state,
      action: PayloadAction<DocumentationStateProps["missingDocumentationMessage"]>
    ) => {
      state.missingDocumentationMessage = action.payload;
    },
    updateSingleDocsPropRightPanel: (
      state,
      action: PayloadAction<DocumentationStateProps["showSingleDocsPropRightPanel"]>
    ) => {
      state.showSingleDocsPropRightPanel = action.payload;
    },
    updateBulkDocsPropRightPanel: (
      state,
      action: PayloadAction<DocumentationStateProps["showBulkDocsPropRightPanel"]>
    ) => {
      state.showBulkDocsPropRightPanel = action.payload;
    },
    setProject: (state, action: PayloadAction<DocumentationStateProps["project"]>) => {
      state.project = action.payload;
      state.docBlocks = [];
    },
    setDocBlocks: (state, action: PayloadAction<DocumentationStateProps["docBlocks"]>) => {
      state.docBlocks = action.payload;
    },
    updateCurrentDocsTests: (
      state,
      action: PayloadAction<DocumentationStateProps["currentDocsTests"]>
    ) => {
      state.currentDocsTests = action.payload;
    },
    updateCurrentUnitTests: (
      state,
      action: PayloadAction<DocumentationStateProps["currentUnitTests"]>
    ) => {
      state.currentUnitTests = action.payload;
    },
    setInsertedEntityName: (state, action: PayloadAction<string | undefined>) => {
      state.insertedEntityName = action.payload;
    },
    setIncomingDocsData: (
      state,
      action: PayloadAction<
        | {
            docs?: DBTDocumentation;
            tests?: DBTModelTest[];
            unitTests?: DBTUnitTest[];
          }
        | undefined
      >
    ) => {
      state.docBlocks = [];
      // if test/docs data is not changed, then update the state
      const isCleanForm = !isStateDirty(state);

      if (
        !state.currentDocsData || // if first load, currentDocsData will be undefined
        isCleanForm
      ) {
        state.incomingDocsData = action.payload ?? {};
        state.currentDocsData = action.payload?.docs;
        state.currentDocsTests = action.payload?.tests;
        state.currentUnitTests = action.payload?.unitTests;
        return;
      }

      // If any changes are done in current model, then show alert
      // empty json to handle cases of switching to file which are not models
      state.incomingDocsData = action.payload ?? {};
      return;
    },
    updateCurrentDocsData: (
      state,
      action: PayloadAction<Partial<DBTDocumentation> | undefined>
    ) => {
      // incase of yml files, incoming docs data will be {}, so checking for keys length as well
      if (!action.payload || !Object.keys(action.payload).length) {
        state.currentDocsData = undefined;
        return;
      }
      if (!action.payload.name) {
        return;
      }
      if (!state.currentDocsData) {
        // Initial render
        // @ts-expect-error TODO fix this type
        state.currentDocsData = action.payload;
        return;
      }

      // switching editor
      if (action.payload.name && state.currentDocsData?.name !== action.payload.name) {
        // @ts-expect-error TODO fix this type
        state.currentDocsData = action.payload;
        return;
      }

      state.currentDocsData = { ...state.currentDocsData, ...action.payload };
    },
    updateColumnsAfterSync: (
      state,
      {
        payload: { columns },
      }: PayloadAction<{
        columns: DBTDocumentation["columns"];
      }>
    ) => {
      if (!state.currentDocsData) {
        return;
      }

      state.currentDocsData.columns = mergeCurrentAndIncomingDocumentationColumns(
        state.currentDocsData.columns,
        columns
      );
    },
    updateColumnsInCurrentDocsData: (
      state,
      {
        payload: { columns },
      }: PayloadAction<{
        columns: Partial<MetadataColumn & { description?: string }>[];
      }>
    ) => {
      if (!state.currentDocsData) {
        return;
      }
      state.currentDocsData.columns = state.currentDocsData.columns.map(c => {
        const updatedColumn = columns.find(column => c.name === column.name);
        if (updatedColumn) {
          return { ...c, ...updatedColumn };
        }
        return c;
      });
    },
  },
});

export const {
  setIncomingDocsData,
  updateCurrentDocsData,
  updateColumnsInCurrentDocsData,
  updateColumnsAfterSync,
  setProject,
  setDocBlocks,
  setInsertedEntityName,
  updateCurrentDocsTests,
  updateCurrentUnitTests,
  setMissingDocumentationMessage,
  setSearchQuery,
  updateSingleDocsPropRightPanel,
  updateBulkDocsPropRightPanel,
} = documentationSlice.actions;
export default documentationSlice;
