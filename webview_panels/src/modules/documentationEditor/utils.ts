import type { documentationEditor } from "@fusion-power-user/webview-contract";
import type {
  DBTDocumentation,
  DBTDocumentationColumn,
  DBTModelTest,
  DocumentationStateProps,
  TestMetadataAcceptedValuesKwArgs,
  TestMetadataRelationshipsKwArgs,
} from "./state/types";
import { DbtGenericTests, Source } from "./state/types";

/** One of the host's columns as the editor keeps it, with absent and `null` fields filled in. */
export const fromHostColumn = (
  column: documentationEditor.Documentation["columns"][number],
): DBTDocumentationColumn => ({
  name: column.name,
  type: column.type ?? undefined,
  description: column.description ?? undefined,
  generated: column.generated ?? false,
  source: column.source === "DATABASE" ? Source.DATABASE : Source.YAML,
  replaceType: column.replaceType,
});

/** The editor's copy of the host's documentation, with absent and `null` fields filled in. */
export const fromHostDocumentation = (
  docs: documentationEditor.Documentation | undefined,
): DBTDocumentation | undefined =>
  docs && {
    name: docs.name,
    description: docs.description ?? "",
    columns: docs.columns.map(fromHostColumn),
    generated: docs.generated ?? false,
    filePath: docs.filePath,
    patchPath: docs.patchPath ?? undefined,
    uniqueId: docs.uniqueId,
    resource_type: docs.resource_type,
  };

const isTestDirty = (
  test: DBTModelTest,
  incomingTest: DBTModelTest,
): boolean => {
  if (test.test_metadata?.name === DbtGenericTests.ACCEPTED_VALUES) {
    const currentValues =
      (
        test.test_metadata?.kwargs as
          | TestMetadataAcceptedValuesKwArgs
          | undefined
      )?.values ?? [];
    const incomingValues =
      (
        incomingTest.test_metadata?.kwargs as
          | TestMetadataAcceptedValuesKwArgs
          | undefined
      )?.values ?? [];
    if (!isArrayEqual(currentValues, incomingValues)) {
      return true;
    }
  }
  if (test.test_metadata?.name === DbtGenericTests.RELATIONSHIPS) {
    const currentArgs = test.test_metadata
      ?.kwargs as TestMetadataRelationshipsKwArgs;
    const incomingArgs = incomingTest.test_metadata
      ?.kwargs as TestMetadataRelationshipsKwArgs;
    return (
      currentArgs.to !== incomingArgs.to ||
      currentArgs.field !== incomingArgs.field
    );
  }
  return false;
};

const areTestsDirty = (state: DocumentationStateProps): boolean => {
  const incomingTests = state.incomingDocsData?.tests;
  if (state.currentDocsTests?.length !== incomingTests?.length) {
    return true;
  }
  return (state.currentDocsTests ?? []).some((test) => {
    const incomingTest = incomingTests?.find((t) => t.key === test.key);
    return !incomingTest || isTestDirty(test, incomingTest);
  });
};

const areColumnsDirty = (state: DocumentationStateProps): boolean => {
  const currentColumns = state.currentDocsData?.columns ?? [];
  const incomingColumns = state.incomingDocsData?.docs?.columns ?? [];
  if (currentColumns.length !== incomingColumns.length) {
    return true;
  }
  return currentColumns.some((column) => {
    const incomingColumn = incomingColumns.find((c) => c.name === column.name);
    return (
      !incomingColumn ||
      column.description !== incomingColumn.description ||
      column.type !== incomingColumn.type
    );
  });
};

export const isStateDirty = (state: DocumentationStateProps): boolean => {
  if (!state.currentDocsData && !state.currentDocsTests) return false;
  if (!state.incomingDocsData) return false;
  if (!state.incomingDocsData.docs && !state.incomingDocsData.tests)
    return false;
  return (
    state.currentDocsData?.description !==
      state.incomingDocsData.docs?.description ||
    areColumnsDirty(state) ||
    areTestsDirty(state)
  );
};

export const isArrayEqual = (a: string[], b: string[]): boolean => {
  return a.length === b.length && a.every((v, i) => v === b[i]);
};
