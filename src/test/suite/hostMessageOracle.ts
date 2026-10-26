// The host-to-panel contract guards. Production only checks what the panels send (`isPanelMessage`), so the suite
// checks what the host posts with these guards, which are test code and not part of the extension.
import type {
  ColumnProposalsPayload,
  ColumnRef,
  DescriptionCandidate,
  DescriptionProposal,
  DescriptionProposalsPayload,
  ProposalSource,
  TypeProposal,
  TypeProposalsPayload,
} from "../../../packages/webview-contract/src/columnProposals";
import type {
  PanelNotice,
  PanelNoticeAction,
  Response,
  ResponseArgs,
} from "../../../packages/webview-contract/src/common";
import { isPanelNoticeActionId } from "../../../packages/webview-contract/src/common";
import type { DocumentationColumn } from "../../../packages/webview-contract/src/documentationColumn";
import type {
  HostMessage as DocumentationEditorHostMessage,
  UnitTest,
} from "../../../packages/webview-contract/src/documentationEditor";
import type {
  Documentation,
  DocumentationDraft,
  ModelTest,
  TestKwargs,
} from "../../../packages/webview-contract/src/documentationEditor";
import type {
  CommandFields,
  Fields,
} from "../../../packages/webview-contract/src/guards";
import {
  arrayOf,
  isAnything,
  isBoolean,
  isNumber,
  isRecord,
  isString,
  messageGuard,
  nullable,
  nullish,
  oneOf,
  optional,
  shape,
  syncRequestId,
} from "../../../packages/webview-contract/src/guards";
import type {
  ModelPreview,
  QueryHistoryEntry,
  HostMessage as QueryResultsHostMessage,
} from "../../../packages/webview-contract/src/queryResults";

const isColumn = shape<DocumentationColumn>({
  name: isString,
  type: nullish(isString),
  description: nullish(isString),
  generated: optional(isBoolean),
  source: optional(oneOf("YAML", "DATABASE")),
  replaceType: optional(isBoolean),
});

const documentationFields: Fields<Documentation> = {
  name: isString,
  description: nullish(isString),
  columns: arrayOf(isColumn),
  generated: optional(isBoolean),
  filePath: isString,
  patchPath: nullish(isString),
  uniqueId: optional(isString),
  resource_type: optional(isString),
};

const isModelTest = shape<ModelTest>({
  key: isString,
  column_name: nullish(isString),
  path: optional(isString),
  test_metadata: optional(
    shape<NonNullable<ModelTest["test_metadata"]>>({
      name: isString,
      namespace: nullish(isString),
      kwargs: shape<TestKwargs>({
        column_name: optional(isString),
        model: optional(isString),
        values: optional(arrayOf(isAnything)),
        field: optional(isString),
        to: optional(isString),
      }),
    }),
  ),
});

const isDocumentation = shape<Documentation>(documentationFields);

const isDraft = shape<DocumentationDraft>({
  docs: isDocumentation,
  tests: optional(arrayOf(isModelTest)),
});

const columnTypes = arrayOf(nullable(isString));

const previewFields = {
  mode: oneOf("computed", "materialized"),
  model: isString,
};
const preview = optional(shape<ModelPreview>(previewFields));

const isHistoryEntry = shape<QueryHistoryEntry>({
  rawSql: isString,
  compiledSql: isString,
  timestamp: isNumber,
  duration: isNumber,
  adapter: isString,
  projectName: isString,
  data: optional(arrayOf(isRecord)),
  columnNames: arrayOf(isString),
  columnTypes,
  modelName: isString,
});

const responseFields: Fields<Omit<Response, "command">> = {
  args: shape<ResponseArgs>({
    syncRequestId,
    body: isAnything,
    status: isBoolean,
    error: optional(isString),
  }),
};

const isPanelNotice = shape<PanelNotice>({
  message: isString,
  type: oneOf("warning", "error"),
  actions: optional(
    arrayOf(
      shape<PanelNoticeAction>({
        title: isString,
        action: isPanelNoticeActionId,
      }),
    ),
  ),
});

const queryResultsHostFields: CommandFields<QueryResultsHostMessage> = {
  response: responseFields,
  renderQuery: {
    columnNames: arrayOf(isString),
    columnTypes,
    rows: arrayOf(isRecord),
    raw_sql: isString,
    compiled_sql: isString,
    preview,
  },
  renderError: {
    error: shape({ code: isNumber, message: isString, data: isAnything }),
    raw_sql: isString,
    compiled_sql: isString,
    preview,
  },
  renderLoading: {},
  resetState: {},
  getContext: {
    limit: isNumber,
    activeEditor: shape({
      query: optional(isString),
      filepath: optional(isString),
    }),
    publication: optional(isString),
  },
  queryHistory: { args: shape({ body: arrayOf(isHistoryEntry) }) },
  updateViewType: {
    args: shape({ body: shape({ type: oneOf(0, 1, 2) }) }),
  },
};

const isUnitTest = shape<UnitTest>({
  name: isString,
  path: optional(isString),
});

const isTargetSource = shape<Extract<ProposalSource, { kind: "target" }>>({
  kind: oneOf("target"),
  target: isString,
  relation: isString,
});

const isDeferredSource = shape<Extract<ProposalSource, { kind: "deferred" }>>({
  kind: oneOf("deferred"),
  target: isString,
  relation: isString,
  state: isString,
});

const isInferredSource = shape<Extract<ProposalSource, { kind: "inferred" }>>({
  kind: oneOf("inferred"),
});

const isProposalSource = (value: unknown): value is ProposalSource =>
  isTargetSource(value) || isDeferredSource(value) || isInferredSource(value);

const isTypeProposal = shape<TypeProposal>({
  column: isString,
  type: isString,
  change: oneOf("fill", "add", "overwrite"),
  current: optional(isString),
});

const isTypeProposalsPayload = shape<TypeProposalsPayload>({
  kind: oneOf("types"),
  model: isString,
  source: optional(isProposalSource),
  proposals: arrayOf(isTypeProposal),
  notFound: arrayOf(isString),
  notice: optional(isPanelNotice),
});

const isColumnRef = shape<ColumnRef>({
  uniqueId: isString,
  column: isString,
});

const isDescriptionCandidate = shape<DescriptionCandidate>({
  description: isString,
  sources: arrayOf(isColumnRef),
});

const isDescriptionProposal = shape<DescriptionProposal>({
  column: isString,
  candidates: arrayOf(isDescriptionCandidate),
});

const isDescriptionProposalsPayload = shape<DescriptionProposalsPayload>({
  kind: oneOf("descriptions"),
  model: isString,
  proposals: arrayOf(isDescriptionProposal),
  notice: optional(isPanelNotice),
});

const isColumnProposalsPayload = (
  value: unknown,
): value is ColumnProposalsPayload =>
  isTypeProposalsPayload(value) || isDescriptionProposalsPayload(value);

const documentationEditorHostFields: CommandFields<DocumentationEditorHostMessage> =
  {
    response: responseFields,
    renderError: {},
    renderDocumentation: {
      docs: optional(isDocumentation),
      missingDocumentationMessage: optional(isPanelNotice),
      tests: optional(arrayOf(isModelTest)),
      unitTests: optional(arrayOf(isUnitTest)),
      project: optional(isString),
      docBlocks: arrayOf(shape({ name: isString, path: isString })),
      publication: optional(isString),
      draft: optional(isDraft),
    },
    renderColumnProposals: { payload: isColumnProposalsPayload },
  };

export const isQueryResultsHostMessage = messageGuard<QueryResultsHostMessage>(
  queryResultsHostFields,
);
export const isDocumentationEditorHostMessage =
  messageGuard<DocumentationEditorHostMessage>(documentationEditorHostFields);
