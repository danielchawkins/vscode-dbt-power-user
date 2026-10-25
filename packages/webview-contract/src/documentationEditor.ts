import type { ColumnProposalsPayload } from "./columnProposals.js";
import { isColumnProposalsPayload } from "./columnProposals.js";
import type {
  OpenProblemsTab,
  PanelNotice,
  PanelNoticeActionId,
  Response,
  ShowNotification,
  WebviewReady,
} from "./common.js";
import {
  isPanelNotice,
  isPanelNoticeActionId,
  responseFields,
  showNotificationFields,
} from "./common.js";
import type { DocumentationColumn } from "./documentationColumn.js";
import type { CommandFields, Fields } from "./guards.js";
import {
  arrayOf,
  isAnything,
  isBoolean,
  isRecord,
  isString,
  messageGuard,
  nullish,
  oneOf,
  optional,
  shape,
  syncRequestId,
} from "./guards.js";

export type { DocumentationColumn } from "./documentationColumn.js";

/** The documentation of the model in the active editor; manifest-derived fields may be `null`. */
export interface Documentation {
  name: string;
  description?: string | null | undefined;
  columns: DocumentationColumn[];
  generated?: boolean | undefined;
  filePath: string;
  patchPath?: string | null | undefined;
  uniqueId?: string | undefined;
  resource_type?: string | undefined;
}

/** A generic test's `test_metadata.kwargs`; which keys appear depends on the test. */
export interface TestKwargs {
  column_name?: string | undefined;
  model?: string | undefined;
  /** `accepted_values`. */
  values?: unknown[] | undefined;
  /** `relationships`: the parent column and the parent `ref`. */
  field?: string | undefined;
  to?: string | undefined;
}

/** A data test attached to the model or one of its columns; `key` is the test's manifest name, and manifest-derived
 * fields may be `null`. */
export interface ModelTest {
  key: string;
  column_name?: string | null | undefined;
  path?: string | undefined;
  test_metadata?:
    | {
        name: string;
        namespace?: string | null | undefined;
        kwargs: TestKwargs;
      }
    | undefined;
}

/** A unit test of the model. */
export interface UnitTest {
  name: string;
  path?: string | undefined;
}

/** The editor's unsaved documentation and tests of one model. */
export interface DocumentationDraft {
  docs: Documentation;
  tests?: ModelTest[] | undefined;
}

/** Documentation-editor messages from the extension host to the panel. */
export type HostMessage =
  | Response
  | { command: "renderError" }
  | { command: "renderColumnProposals"; payload: ColumnProposalsPayload }
  /** `docs` is absent when the active editor has no documented model. */
  | {
      command: "renderDocumentation";
      docs?: Documentation | undefined;
      missingDocumentationMessage?: PanelNotice | undefined;
      tests?: ModelTest[] | undefined;
      unitTests?: UnitTest[] | undefined;
      project?: string | undefined;
      docBlocks: { name: string; path: string }[];
      /** The manifest publication the documentation was read from; the panel's saved view state names it. */
      publication?: string | undefined;
      /** The unsaved draft the host holds for this model; the editor shows it over `docs` and `tests`. */
      draft?: DocumentationDraft | undefined;
    };

/** Where `saveDocumentation` writes when the model has no `patchPath`. */
export type SaveDialog = "Existing file" | "New file";

/** Documentation-editor messages from the panel to the extension host. */
export type PanelMessage =
  | WebviewReady
  | OpenProblemsTab
  | ShowNotification
  | { command: "getCurrentModelDocumentation" }
  /** The editor's unsaved draft of the model at file path `model`, kept in host memory; absent clears it. */
  | {
      command: "saveDraft";
      model: string;
      draft?: DocumentationDraft | undefined;
    }
  | {
      command: "getTestCode";
      test: Record<string, unknown>;
      model: string;
      syncRequestId?: string | undefined;
    }
  | {
      command: "getUnitTestCode";
      path?: string | undefined;
      model?: string | undefined;
      name?: string | undefined;
      syncRequestId?: string | undefined;
    }
  | {
      command: "getDistinctColumnValues";
      /** Absent or `null` before the panel has loaded a model. */
      model?: string | null | undefined;
      column: string;
      syncRequestId?: string | undefined;
    }
  | {
      command: "getColumnsOfSources";
      source: string;
      table: string;
      syncRequestId?: string | undefined;
    }
  | {
      command: "getColumnsOfModel";
      model: string;
      syncRequestId?: string | undefined;
    }
  | { command: "getSourcesInProject"; syncRequestId?: string | undefined }
  | { command: "getModelsInProject"; syncRequestId?: string | undefined }
  /** Asks for the proposals of `kind` for the active model, answered by `renderColumnProposals`. */
  | { command: "proposeColumns"; kind: ColumnProposalsPayload["kind"] }
  | { command: "runNoticeAction"; action: PanelNoticeActionId }
  /** `updatedTests` is the panel's test metadata for the model and its columns. */
  | (Documentation & {
      command: "saveDocumentation";
      updatedTests?: unknown;
      dialogType?: SaveDialog | undefined;
      syncRequestId?: string | undefined;
    });

/** The body the host answers each request with, by request command. */
export interface ResponseBodies {
  getTestCode: { sql?: string | undefined; config?: string | null | undefined };
  getUnitTestCode: { yaml: string } | { error: string };
  getDistinctColumnValues: unknown[];
  getColumnsOfSources: { columns: string[] };
  getColumnsOfModel: { columns: string[] };
  /** Absent when the active file has no manifest. */
  getSourcesInProject: {
    sources: { name: string; tables: string[] }[] | undefined;
  };
  /** Absent when the active file has no manifest. */
  getModelsInProject: { models: string[] | undefined };
  showWarningMessage: string | undefined;
  showInformationMessage: string | undefined;
  saveDocumentation:
    | { saved: false }
    | {
        saved: true;
        tests?: ModelTest[] | undefined;
        unitTests?: UnitTest[] | undefined;
        documentation?: Documentation | undefined;
      };
}

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

const isUnitTest = shape<UnitTest>({
  name: isString,
  path: optional(isString),
});

const isDocumentation = shape<Documentation>(documentationFields);

const isDraft = shape<DocumentationDraft>({
  docs: isDocumentation,
  tests: optional(arrayOf(isModelTest)),
});

const hostFields: CommandFields<HostMessage> = {
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

const panelFields: CommandFields<PanelMessage> = {
  "webview:ready": {},
  openProblemsTab: {},
  showInformationMessage: showNotificationFields,
  showWarningMessage: showNotificationFields,
  getCurrentModelDocumentation: {},
  saveDraft: { model: isString, draft: optional(isDraft) },
  getTestCode: { test: isRecord, model: isString, syncRequestId },
  getUnitTestCode: {
    path: optional(isString),
    model: optional(isString),
    name: optional(isString),
    syncRequestId,
  },
  getDistinctColumnValues: {
    model: nullish(isString),
    column: isString,
    syncRequestId,
  },
  getColumnsOfSources: { source: isString, table: isString, syncRequestId },
  getColumnsOfModel: { model: isString, syncRequestId },
  getSourcesInProject: { syncRequestId },
  getModelsInProject: { syncRequestId },
  proposeColumns: { kind: oneOf("types", "descriptions") },
  runNoticeAction: { action: isPanelNoticeActionId },
  saveDocumentation: {
    ...documentationFields,
    updatedTests: isAnything,
    dialogType: optional(oneOf("Existing file", "New file")),
    syncRequestId,
  },
};

export const isHostMessage = messageGuard<HostMessage>(hostFields);
export const isPanelMessage = messageGuard<PanelMessage>(panelFields);

export const hostCommands = Object.keys(hostFields) as HostMessage["command"][];
export const panelCommands = Object.keys(
  panelFields,
) as PanelMessage["command"][];
