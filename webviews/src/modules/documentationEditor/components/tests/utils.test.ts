import type { documentationEditor } from "@fusion-power-user/webview-contract";
import {
  DbtGenericTests,
  DbtTestTypes,
} from "@modules/documentationEditor/state/types";
import { describe, expect, it } from "vitest";
import { findDbtTestType } from "./utils";

const modelTest = (
  testMetadata?: documentationEditor.ModelTest["test_metadata"],
  path?: string,
): documentationEditor.ModelTest => ({
  key: "test",
  path,
  test_metadata: testMetadata,
});

const metadata = (
  name: string,
  namespace?: string,
): NonNullable<documentationEditor.ModelTest["test_metadata"]> => ({
  name,
  namespace,
  kwargs: {},
});

describe("findDbtTestType", () => {
  it("reads a test without metadata that is a .sql file as singular", () => {
    expect(
      findDbtTestType(modelTest(undefined, "tests/assert_positive.sql")),
    ).toBe(DbtTestTypes.SINGULAR);
  });

  it("reads a test without metadata that is not a .sql file as unknown", () => {
    expect(findDbtTestType(modelTest(undefined, "tests/assert.py"))).toBe(
      DbtTestTypes.UNKNOWN,
    );
    expect(findDbtTestType(modelTest(undefined))).toBe(DbtTestTypes.UNKNOWN);
  });

  it.each(Object.values(DbtGenericTests))(
    "reads the dbt generic test %s as generic",
    (name) => {
      expect(
        findDbtTestType(modelTest(metadata(name), "models/schema.yml")),
      ).toBe(DbtTestTypes.GENERIC);
    },
  );

  it("reads a generic test name as generic even when it has a namespace", () => {
    expect(findDbtTestType(modelTest(metadata("not_null", "dbt_utils")))).toBe(
      DbtTestTypes.GENERIC,
    );
  });

  it("reads a non-generic test with a namespace as an external package test", () => {
    expect(
      findDbtTestType(
        modelTest(metadata("expect_column_values", "dbt_expectations")),
      ),
    ).toBe(DbtTestTypes.EXTERNAL_PACKAGE);
  });

  it("reads a non-generic test without a namespace as a macro test", () => {
    expect(findDbtTestType(modelTest(metadata("my_check")))).toBe(
      DbtTestTypes.MACRO,
    );
  });
});
