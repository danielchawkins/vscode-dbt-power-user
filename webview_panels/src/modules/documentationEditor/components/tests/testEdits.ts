import type {
  DBTModelTest,
  TestMetadataAcceptedValuesKwArgs,
  TestMetadataRelationshipsKwArgs,
} from "@modules/documentationEditor/state/types";
import { DbtGenericTests } from "@modules/documentationEditor/state/types";
import type { SaveRequest } from "./types";

export const TestOperation = {
  CREATE: 0,
  UPDATE: 1,
  DELETE: 2,
} as const;
export type TestOperation = (typeof TestOperation)[keyof typeof TestOperation];

interface EditTestsArgs {
  tests: DBTModelTest[];
  column: string;
  model: string;
  request: SaveRequest;
  operation: TestOperation;
  /** The key of a created test. The hook hashes the request; the other operations ignore it. */
  key: string;
}

const updateTests = ({
  testsData,
  data,
  type,
  column,
}: {
  testsData: DBTModelTest[];
  data:
    | Partial<TestMetadataAcceptedValuesKwArgs>
    | Partial<TestMetadataRelationshipsKwArgs>;
  type: DbtGenericTests;
  column: string;
}): DBTModelTest[] => {
  const temp = [...testsData];
  const currentIndex = temp.findIndex(
    (test: DBTModelTest) =>
      test.test_metadata?.name === type &&
      test.test_metadata.kwargs.column_name === column,
  );
  const existing = temp[currentIndex];
  if (existing) {
    temp[currentIndex] = {
      ...existing,
      test_metadata: {
        ...existing.test_metadata,
        name: existing.test_metadata?.name ?? "",
        kwargs: {
          ...existing.test_metadata?.kwargs,
          ...data,
        },
      },
    };
    return temp;
  }

  return temp;
};

/** The model's tests after one edit. `tests` is copied, not changed. */
export const editTests = ({
  tests,
  column,
  model,
  request,
  operation,
  key,
}: EditTestsArgs): DBTModelTest[] => {
  const testsData = [...tests];
  const newValues = request.accepted_values?.map((s) => s.trim());
  if (operation === TestOperation.DELETE) {
    return testsData.filter((test: DBTModelTest) => {
      if (test.test_metadata?.kwargs.column_name !== column) {
        return true;
      }

      return test.test_metadata?.name !== request.test?.toString();
    });
  }
  if (operation === TestOperation.CREATE) {
    testsData.push({
      column_name: column,
      key,
      test_metadata: {
        name: request.test!,
        kwargs: {
          column_name: column,
          model,
          ...(newValues && { values: newValues }),
          ...(request.to && { to: request.to }),
          ...(request.field && { field: request.field }),
        },
      },
    });
    return testsData;
  }

  if (request.test === DbtGenericTests.ACCEPTED_VALUES) {
    return updateTests({
      testsData,
      data: { values: newValues ?? [] },
      type: DbtGenericTests.ACCEPTED_VALUES,
      column,
    });
  }

  if (request.test === DbtGenericTests.RELATIONSHIPS) {
    return updateTests({
      testsData,
      data: {
        to: request.to ?? undefined,
        field: request.field,
      },
      type: DbtGenericTests.RELATIONSHIPS,
      column,
    });
  }
  return testsData;
};
