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

export const getColumnTestConfigFromYml = (
  allTests: any[] | undefined,
  kwargs:
    | TestMetadataAcceptedValues
    | TestMetadataRelationships
    | { [x: string]: unknown },
  testName: string,
) => {
  const testsByTestName = allTests?.filter((t: any) => {
    if (typeof t === "string") {
      return t === testName;
    }
    const [key] = Object.keys(t);
    return key === testName;
  });

  const testWithRightConfigValues = testsByTestName?.find((t: any) => {
    if (typeof t === "string") {
      return t === testName;
    }

    if (isRelationship(kwargs)) {
      return (
        kwargs.field === t.relationships.field &&
        kwargs.to === t.relationships.to
      );
    }

    if (isAcceptedValues(kwargs)) {
      return (
        kwargs.values?.sort().toString() ===
        t.accepted_values.values.sort().toString()
      );
    }

    // For multiple tests with same name but diff config from  external packages like dbt_utils,
    // match all the config values
    const { model: _model, column_name: _columnName, ...rest } = kwargs;
    return Object.entries(rest).every(([k, v]) => t[testName][k] === v);
  });

  if (isRelationship(kwargs)) {
    return (
      testWithRightConfigValues as
        { relationships: TestMetadataAcceptedValues } | undefined
    )?.["relationships"];
  }

  if (isAcceptedValues(kwargs)) {
    return (
      testWithRightConfigValues as
        { accepted_values: TestMetadataAcceptedValues } | undefined
    )?.["accepted_values"];
  }

  if (testWithRightConfigValues?.[testName]) {
    return {
      [testName]: testWithRightConfigValues?.[testName],
    };
  }
};
