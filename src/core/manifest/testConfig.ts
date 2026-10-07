import type {
  TestMetadataAcceptedValues,
  TestMetadataRelationships,
} from "./types";

export const isRelationship = (
  metadata:
    | TestMetadataRelationships
    | TestMetadataAcceptedValues
    | { [x: string]: unknown },
): metadata is TestMetadataRelationships => {
  return (
    (metadata as TestMetadataRelationships).field !== undefined &&
    (metadata as TestMetadataRelationships).to !== undefined
  );
};

export const isAcceptedValues = (
  metadata:
    | TestMetadataRelationships
    | TestMetadataAcceptedValues
    | { [x: string]: unknown },
): metadata is TestMetadataAcceptedValues => {
  return (metadata as TestMetadataAcceptedValues).values !== undefined;
};

/** A test as a schema YAML lists it: a bare name, or a name mapped to its config (`null` for `- not_null:`). */
export type YamlTest = string | Record<string, Record<string, unknown> | null>;

const nameOf = (test: YamlTest): string | undefined =>
  typeof test === "string" ? test : Object.keys(test)[0];

/** Whether `test` carries the config values `kwargs` names. */
function matchesConfig(
  test: Exclude<YamlTest, string>,
  kwargs:
    | TestMetadataAcceptedValues
    | TestMetadataRelationships
    | Record<string, unknown>,
  testName: string,
): boolean {
  if (isRelationship(kwargs)) {
    const relationships = test.relationships ?? {};
    return (
      kwargs.field === relationships.field && kwargs.to === relationships.to
    );
  }
  if (isAcceptedValues(kwargs)) {
    const values = (test.accepted_values?.values ?? []) as string[];
    return kwargs.values?.sort().toString() === values.sort().toString();
  }
  // For multiple tests with same name but diff config from external packages like dbt_utils,
  // match all the config values
  const { model: _model, column_name: _columnName, ...rest } = kwargs;
  return Object.entries(rest).every(([k, v]) => test[testName]?.[k] === v);
}

export const getColumnTestConfigFromYml = (
  allTests: YamlTest[] | undefined,
  kwargs:
    | TestMetadataAcceptedValues
    | TestMetadataRelationships
    | { [x: string]: unknown },
  testName: string,
) => {
  const found = allTests
    ?.filter((t) => nameOf(t) === testName)
    .find((t) => typeof t === "string" || matchesConfig(t, kwargs, testName));

  if (isRelationship(kwargs)) {
    return (found as { relationships: TestMetadataAcceptedValues } | undefined)
      ?.relationships;
  }
  if (isAcceptedValues(kwargs)) {
    return (
      found as { accepted_values: TestMetadataAcceptedValues } | undefined
    )?.accepted_values;
  }
  const config = typeof found === "string" ? undefined : found?.[testName];
  return config ? { [testName]: config } : undefined;
};
