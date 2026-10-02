import {
  isPanelNotice,
  OpenProblemsTab,
  PanelNotice,
  Response,
  responseFields,
  ShowNotification,
  showNotificationFields,
  WebviewReady,
} from "./common.js";
import {
  arrayOf,
  CommandFields,
  Fields,
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

/** A column of the model being documented; `source` says whether it came from YAML or a database fetch. */
export interface DocumentationColumn {
  name: string;
  type?: string | null;
  description?: string | null;
  generated?: boolean;
  source?: "YAML" | "DATABASE";
}

/** The documentation of the model in the active editor; manifest-derived fields may be `null`. */
export interface Documentation {
  name: string;
  description?: string | null;
  columns: DocumentationColumn[];
  generated?: boolean;
  filePath: string;
  patchPath?: string | null;
  uniqueId?: string;
  resource_type?: string;
}

/** A generic test's `test_metadata.kwargs`; which keys appear depends on the test. */
export interface TestKwargs {
  column_name?: string;
  model?: string;
  /** `accepted_values`. */
  values?: unknown[];
  /** `relationships`: the parent column and the parent `ref`. */
  field?: string;
  to?: string;
}

/** A data test attached to the model or one of its columns; `key` is the test's manifest name, and manifest-derived
 * fields may be `null`. */
export interface ModelTest {
  key: string;
  column_name?: string | null;
  path?: string;
  test_metadata?: {
    name: string;
    namespace?: string | null;
    kwargs: TestKwargs;
  };
}

/** A unit test of the model. */
export interface UnitTest {
  name: string;
  path?: string;
}

/** Documentation-editor messages from the extension host to the panel. */
export type HostMessage =
  | Response
  | { command: "renderError" }
  /** `docs` is absent when the active editor has no documented model. */
  | {
      command: "renderDocumentation";
      docs?: Documentation;
      missingDocumentationMessage?: PanelNotice;
      tests?: ModelTest[];
      unitTests?: UnitTest[];
      project?: string;
      docBlocks: { name: string; path: string }[];
    }
  | {
      command: "renderColumnsFromMetadataFetch";
      columns: { name: string; type?: string }[];
    };

/** Where `saveDocumentation` writes when the model has no `patchPath`. */
export type SaveDialog = "Existing file" | "New file";

/** Documentation-editor messages from the panel to the extension host. */
export type PanelMessage =
  | WebviewReady
  | OpenProblemsTab
  | ShowNotification
  | { command: "getCurrentModelDocumentation" }
  | {
      command: "getTestCode";
      test: Record<string, unknown>;
      model: string;
      syncRequestId?: string;
    }
  | {
      command: "getUnitTestCode";
      path?: string;
      model?: string;
      name?: string;
      syncRequestId?: string;
    }
  | {
      command: "getDistinctColumnValues";
      /** Absent or `null` before the panel has loaded a model. */
      model?: string | null;
      column: string;
      syncRequestId?: string;
    }
  | {
      command: "getColumnsOfSources";
      source: string;
      table: string;
      syncRequestId?: string;
    }
  | { command: "getColumnsOfModel"; model: string; syncRequestId?: string }
  | { command: "getSourcesInProject"; syncRequestId?: string }
  | { command: "getModelsInProject"; syncRequestId?: string }
  | { command: "fetchMetadataFromDatabase"; syncRequestId?: string }
  /** `updatedTests` is the panel's test metadata for the model and its columns. */
  | (Documentation & {
      command: "saveDocumentation";
      updatedTests?: unknown;
      dialogType?: SaveDialog;
      syncRequestId?: string;
    });

const isColumn = shape<DocumentationColumn>({
  name: isString,
  type: nullish(isString),
  description: nullish(isString),
  generated: optional(isBoolean),
  source: optional(oneOf("YAML", "DATABASE")),
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

const hostFields: CommandFields<HostMessage> = {
  response: responseFields,
  renderError: {},
  renderDocumentation: {
    docs: optional(shape<Documentation>(documentationFields)),
    missingDocumentationMessage: optional(isPanelNotice),
    tests: optional(arrayOf(isModelTest)),
    unitTests: optional(arrayOf(isUnitTest)),
    project: optional(isString),
    docBlocks: arrayOf(shape({ name: isString, path: isString })),
  },
  renderColumnsFromMetadataFetch: {
    columns: arrayOf(shape({ name: isString, type: optional(isString) })),
  },
};

const panelFields: CommandFields<PanelMessage> = {
  "webview:ready": {},
  openProblemsTab: {},
  showInformationMessage: showNotificationFields,
  showWarningMessage: showNotificationFields,
  getCurrentModelDocumentation: {},
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
  fetchMetadataFromDatabase: { syncRequestId },
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
