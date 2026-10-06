import type { Log } from "../../core/log";
import {
  getColumnTestConfigFromYml,
  isAcceptedValues,
  isRelationship,
  type YamlTest,
} from "../../core/manifest/testConfig";
import type {
  TestMetaData,
  TestMetadataAcceptedValues,
  TestMetadataRelationships,
} from "../../core/manifest/types";
import { isColumnNameEqual } from "../../projects/columnNames";
import type { DbtTestService } from "./dbtTestService";

export interface TestDataDeps {
  terminal: Pick<Log, "debug">;
  dbtTestService: Pick<DbtTestService, "removeDuplicateTests">;
}

/** A YAML `tests` or `data_tests` key. */
export interface TestKeys {
  tests?: unknown[];
  data_tests?: unknown[];
}

/** What the panel sends on save: the tests it holds, unsorted by model or column. */
export interface UpdatedTests {
  updatedTests?: unknown;
}

function getTestMetadataKwArgs(
  kwargs: TestMetadataAcceptedValues | TestMetadataRelationships,
  fullName: string,
) {
  if (!kwargs) {
    return undefined;
  }
  const rest = Object.fromEntries(
    Object.entries(kwargs).filter(
      // These fields are added by default.
      ([key]) => key !== "column_name" && key !== "model",
    ),
  );
  return Object.keys(rest).length ? { [fullName]: rest } : undefined;
}

const fullNameOf = (test: TestMetaData): string | undefined => {
  if (!test.test_metadata) {
    return undefined;
  }
  const { name, namespace } = test.test_metadata;
  return namespace ? `${namespace}.${name}` : name;
};

/** Whether `test` is declared on `modelName`; the model may be written `{{ get_where_subquery(ref('x')) }}`. */
function isModelTestOf(test: TestMetaData, modelName: string): boolean {
  const modelNameInTest = test.test_metadata?.kwargs.model;
  if (test.column_name || !modelNameInTest) {
    return false;
  }
  return (
    modelNameInTest === modelName ||
    modelNameInTest.match(/'([^']+)'/)?.[1] === modelName
  );
}

/** The tests to write under a model: `data_tests`, or `tests` when the model's YAML already uses that key. */
export function getTestDataByModel(
  message: UpdatedTests,
  modelName: string,
  existingModel: { tests?: unknown } | undefined,
  deps: TestDataDeps,
): TestKeys | undefined {
  const tests = message.updatedTests as undefined | TestMetaData[];
  if (!tests?.length) {
    deps.terminal.debug(
      "docsEditViewPanel:getTestDataByModel",
      "No test data passed",
    );
    return undefined;
  }
  const finalTests = tests
    .filter((test) => isModelTestOf(test, modelName))
    .map((test) => {
      const fullName = fullNameOf(test);
      if (!fullName || !test.test_metadata) {
        return null;
      }
      // Add extra config from external packages or test macros
      return (
        getTestMetadataKwArgs(test.test_metadata.kwargs, fullName) || fullName
      );
    })
    .filter((t) => Boolean(t));
  const filteredTests = deps.dbtTestService.removeDuplicateTests(finalTests);
  if (!filteredTests.length) {
    return undefined;
  }
  return existingModel?.tests === undefined
    ? { data_tests: filteredTests }
    : { tests: filteredTests };
}

/** One column test as YAML: its config from the existing YAML merged with what the panel edited. */
function columnTestEntry(
  test: TestMetaData,
  existingColumn: { tests?: unknown } | undefined,
): unknown {
  const fullName = fullNameOf(test);
  if (!fullName || !test.test_metadata) {
    return null;
  }
  const { kwargs } = test.test_metadata;
  const fromYml = getColumnTestConfigFromYml(
    existingColumn?.tests as YamlTest[] | undefined,
    kwargs,
    fullName,
  );
  if (isRelationship(kwargs)) {
    return {
      relationships: { ...fromYml, field: kwargs.field, to: kwargs.to },
    };
  }
  if (isAcceptedValues(kwargs)) {
    return { accepted_values: { ...fromYml, values: kwargs.values } };
  }
  return fromYml || getTestMetadataKwArgs(kwargs, fullName) || fullName;
}

/** The tests to write under a column: `data_tests`, or `tests` when the column's YAML already uses that key. */
export function getTestDataByColumn(
  message: UpdatedTests,
  columnNameFromWebview: string,
  existingColumn: { name?: string; tests?: unknown } | undefined,
  deps: TestDataDeps,
): TestKeys | undefined {
  const tests = message.updatedTests as undefined | TestMetaData[];
  if (!tests?.length) {
    deps.terminal.debug(
      "docsEditViewPanel:getTestDataByColumn",
      "No test data passed",
    );
    return undefined;
  }
  const columnTests = tests.filter((test) =>
    isColumnNameEqual(test.column_name, columnNameFromWebview),
  );
  // No tests for this column: they may all be deleted.
  if (!columnTests.length) {
    return undefined;
  }
  const data = columnTests.map((test) => columnTestEntry(test, existingColumn));
  deps.terminal.debug(
    "docsEditViewPanel:getTestDataByColumn",
    "test data",
    false,
    data,
    columnNameFromWebview,
  );
  const dataWithoutDupes = deps.dbtTestService.removeDuplicateTests(
    data as Parameters<
      TestDataDeps["dbtTestService"]["removeDuplicateTests"]
    >[0],
  );
  return existingColumn?.name === columnNameFromWebview &&
    existingColumn?.tests === undefined
    ? { data_tests: dataWithoutDupes }
    : { tests: dataWithoutDupes };
}
