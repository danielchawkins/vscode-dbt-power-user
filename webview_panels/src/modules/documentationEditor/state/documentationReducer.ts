import * as columnProposals from "@fusion-power-user/webview-contract/columnProposals";
import { typedReducer } from "@modules/app/typedReducer";
import type { ProposalChoices } from "../proposals/proposalsReducer";
import { fromHostColumn, isStateDirty } from "../utils";
import type { RenderMessage } from "./incomingDocs";
import type {
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

// The same steps, in the same order, as the separate updates a render used to dispatch.
const takeRendered = (state: S, message: RenderMessage): S => {
  const taken = takeIncomingDocs(state, {
    docs: message.docs,
    tests: message.tests,
    unitTests: message.unitTests,
  });
  const next: S = {
    ...taken,
    project: message.project,
    missingDocumentationMessage: message.missingDocumentationMessage,
    docBlocks: message.docBlocks,
    publication: message.publication,
  };
  if (!message.draft) {
    return next;
  }
  return {
    ...mergeCurrentDocs(next, message.draft.docs),
    currentDocsTests: message.draft.tests,
  };
};

const documentation = typedReducer<
  S,
  {
    setSearchQuery: S["searchQuery"];
    updateCurrentDocsTests: S["currentDocsTests"];
    updateCurrentUnitTests: S["currentUnitTests"];
    setIncomingDocsData: Parameters<typeof takeIncomingDocs>[1];
    rendered: RenderMessage;
    updateCurrentDocsData: Parameters<typeof mergeCurrentDocs>[1];
    updateColumnsInCurrentDocsData: {
      columns: Partial<MetadataColumn & { description?: string }>[];
    };
    applyColumnProposals: {
      proposals: {
        types: columnProposals.TypeProposal[];
        descriptions: columnProposals.DescriptionProposal[];
      };
      choices: ProposalChoices;
    };
  }
>({
  setSearchQuery: set("searchQuery"),
  updateCurrentDocsTests: set("currentDocsTests"),
  updateCurrentUnitTests: set("currentUnitTests"),
  setIncomingDocsData: takeIncomingDocs,
  rendered: takeRendered,
  updateCurrentDocsData: mergeCurrentDocs,
  updateColumnsInCurrentDocsData: (state, { columns }) =>
    withColumns(state, (current) =>
      current.map((c) => {
        const updatedColumn = columns.find((column) => c.name === column.name);
        return updatedColumn ? { ...c, ...updatedColumn } : c;
      }),
    ),
  // Types first, then descriptions; the contract skips what its choices do not pick.
  applyColumnProposals: (state, { proposals, choices }) =>
    withColumns(state, (current) =>
      columnProposals
        .applyDescriptionProposals(
          columnProposals.applyProposals(
            current,
            proposals.types,
            choices.types,
          ),
          proposals.descriptions,
          choices.descriptions,
        )
        .map(fromHostColumn),
    ),
});

export const documentationReducer = documentation.reducer;
export type DocumentationAction = Parameters<typeof documentationReducer>[1];
export const {
  setIncomingDocsData,
  rendered,
  updateCurrentDocsData,
  updateColumnsInCurrentDocsData,
  applyColumnProposals,
  updateCurrentDocsTests,
  updateCurrentUnitTests,
  setSearchQuery,
} = documentation.actions;
