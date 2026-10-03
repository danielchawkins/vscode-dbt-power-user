import type { documentationEditor } from "@fusion-power-user/webview-contract";
import {
  DBTDocumentation,
  DBTDocumentationColumn,
  DbtGenericTests,
  DocumentationStateProps,
  Source,
  TestMetadataAcceptedValuesKwArgs,
  TestMetadataRelationshipsKwArgs,
} from "./state/types";

/** The editor's copy of the host's documentation, with absent and `null` fields filled in. */
export const fromHostDocumentation = (
  docs: documentationEditor.Documentation | undefined,
): DBTDocumentation | undefined =>
  docs && {
    name: docs.name,
    description: docs.description ?? "",
    columns: docs.columns.map(
      (column): DBTDocumentationColumn => ({
        name: column.name,
        type: column.type ?? undefined,
        description: column.description ?? undefined,
        generated: column.generated ?? false,
        source: column.source === "DATABASE" ? Source.DATABASE : Source.YAML,
      }),
    ),
    generated: docs.generated ?? false,
    filePath: docs.filePath,
    patchPath: docs.patchPath ?? undefined,
    uniqueId: docs.uniqueId,
    resource_type: docs.resource_type,
  };

/** Columns a warehouse metadata fetch returned, as editor columns that are not yet in YAML. */
export const fromFetchedColumns = (
  columns: { name: string; type?: string }[],
): DBTDocumentationColumn[] =>
  columns.map((column) => ({
    name: column.name,
    type: column.type,
    generated: false,
    source: Source.DATABASE,
  }));

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
