import {
  DBTDocumentation,
  DbtGenericTests,
  DocumentationStateProps,
  Source,
  TestMetadataAcceptedValuesKwArgs,
  TestMetadataRelationshipsKwArgs,
} from "./state/types";

export const mergeCurrentAndIncomingDocumentationColumns = (
  current: DBTDocumentation["columns"] | undefined,
  incoming: DBTDocumentation["columns"],
): DBTDocumentation["columns"] => {
  return incoming.map((column) => {
    const existingColumn = current?.find((c) => column.name === c.name);
    return {
      name: column.name ?? "",
      type: column.type,
      description: existingColumn?.description ?? "",
      generated: existingColumn?.generated ?? false,
      source: existingColumn !== undefined ? Source.YAML : Source.DATABASE,
    };
  });
};

export const isStateDirty = (state: DocumentationStateProps): boolean => {
  if (!state.currentDocsData && !state.currentDocsTests) return false;
  if (!state.incomingDocsData) return false;
  if (!state.incomingDocsData.docs && !state.incomingDocsData.tests)
    return false;
  if (
    state.currentDocsData?.description !==
    state.incomingDocsData.docs?.description
  ) {
    return true;
  }

  for (const column of state.currentDocsData?.columns ?? []) {
    const incomingColumn = state.incomingDocsData.docs?.columns?.find(
      (c) => c.name === column.name,
    );
    if (column.description !== incomingColumn?.description) {
      return true;
    }
  }
  if (state.currentDocsTests?.length !== state.incomingDocsData.tests?.length) {
    return true;
  }
  for (const test of state.currentDocsTests ?? []) {
    const incomingTest = state.incomingDocsData.tests?.find(
      (t) => t.key === test.key,
    );
    if (!incomingTest) {
      return true;
    }
    if (test.test_metadata?.name === DbtGenericTests.ACCEPTED_VALUES) {
      const currentValues =
        (test.test_metadata?.kwargs as TestMetadataAcceptedValuesKwArgs)
          .values ?? [];
      const incomingValues =
        (incomingTest.test_metadata?.kwargs as TestMetadataAcceptedValuesKwArgs)
          .values ?? [];
      if (!isArrayEqual(currentValues, incomingValues)) {
        return true;
      }
    }
    if (test.test_metadata?.name === DbtGenericTests.RELATIONSHIPS) {
      const currentArgs = test.test_metadata
        ?.kwargs as TestMetadataRelationshipsKwArgs;
      const incomingArgs = incomingTest.test_metadata
        ?.kwargs as TestMetadataRelationshipsKwArgs;
      if (
        currentArgs.to !== incomingArgs.to ||
        currentArgs.field !== incomingArgs.field
      ) {
        return true;
      }
    }
  }
  return false;
};

export const isArrayEqual = (a: string[], b: string[]): boolean => {
  return a.length === b.length && a.every((v, i) => v === b[i]);
};
