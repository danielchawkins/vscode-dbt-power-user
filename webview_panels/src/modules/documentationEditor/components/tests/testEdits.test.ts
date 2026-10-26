import {
  DbtGenericTests,
  type DBTModelTest,
} from "@modules/documentationEditor/state/types";
import { describe, expect, it } from "vitest";
import { editTests, TestOperation } from "./testEdits";

const MODEL = "orders";

const acceptedValues = (column: string, values: string[]): DBTModelTest => ({
  key: `av-${column}`,
  column_name: column,
  test_metadata: {
    name: DbtGenericTests.ACCEPTED_VALUES,
    kwargs: { column_name: column, model: MODEL, values },
  },
});

const relationships = (
  column: string,
  to: string,
  field: string,
): DBTModelTest => ({
  key: `rel-${column}`,
  column_name: column,
  test_metadata: {
    name: DbtGenericTests.RELATIONSHIPS,
    kwargs: { column_name: column, model: MODEL, to, field },
  },
});

describe("editTests", () => {
  it("appends a created accepted_values test with trimmed values and the given key", () => {
    const result = editTests({
      tests: [],
      column: "status",
      model: MODEL,
      request: {
        test: DbtGenericTests.ACCEPTED_VALUES,
        accepted_values: [" open ", "closed"],
      },
      operation: TestOperation.CREATE,
      key: "hash-1",
    });

    expect(result).toEqual([
      {
        column_name: "status",
        key: "hash-1",
        test_metadata: {
          name: DbtGenericTests.ACCEPTED_VALUES,
          kwargs: {
            column_name: "status",
            model: MODEL,
            values: ["open", "closed"],
          },
        },
      },
    ]);
  });

  it("omits the optional kwargs of a created test that has none", () => {
    const [created] = editTests({
      tests: [],
      column: "id",
      model: MODEL,
      request: { test: DbtGenericTests.NOT_NULL },
      operation: TestOperation.CREATE,
      key: "hash-2",
    });

    expect(created?.test_metadata?.kwargs).toEqual({
      column_name: "id",
      model: MODEL,
    });
  });

  it("creates a relationships test with its target and field", () => {
    const [created] = editTests({
      tests: [],
      column: "customer_id",
      model: MODEL,
      request: {
        test: DbtGenericTests.RELATIONSHIPS,
        to: "ref('customers')",
        field: "id",
      },
      operation: TestOperation.CREATE,
      key: "hash-3",
    });

    expect(created?.test_metadata?.kwargs).toEqual({
      column_name: "customer_id",
      model: MODEL,
      to: "ref('customers')",
      field: "id",
    });
  });

  it("replaces the values of the accepted_values test on the column", () => {
    const tests = [
      acceptedValues("status", ["open"]),
      acceptedValues("other", ["x"]),
    ];

    const result = editTests({
      tests,
      column: "status",
      model: MODEL,
      request: {
        test: DbtGenericTests.ACCEPTED_VALUES,
        accepted_values: [" new "],
      },
      operation: TestOperation.UPDATE,
      key: "",
    });

    expect(result[0]).toEqual({
      ...tests[0],
      test_metadata: {
        name: DbtGenericTests.ACCEPTED_VALUES,
        kwargs: { column_name: "status", model: MODEL, values: ["new"] },
      },
    });
    expect(result[1]).toBe(tests[1]);
  });

  it("updates the target and field of the relationships test on the column", () => {
    const tests = [relationships("customer_id", "ref('a')", "id")];

    const [updated] = editTests({
      tests,
      column: "customer_id",
      model: MODEL,
      request: {
        test: DbtGenericTests.RELATIONSHIPS,
        to: "ref('b')",
        field: "key",
      },
      operation: TestOperation.UPDATE,
      key: "",
    });

    expect(updated?.test_metadata?.kwargs).toEqual({
      column_name: "customer_id",
      model: MODEL,
      to: "ref('b')",
      field: "key",
    });
    expect(updated?.key).toBe("rel-customer_id");
  });

  it("leaves the tests alone when an update finds no test on the column", () => {
    const tests = [acceptedValues("status", ["open"])];

    const result = editTests({
      tests,
      column: "missing",
      model: MODEL,
      request: {
        test: DbtGenericTests.ACCEPTED_VALUES,
        accepted_values: ["x"],
      },
      operation: TestOperation.UPDATE,
      key: "",
    });

    expect(result).toEqual(tests);
  });

  it("deletes the test of that name on the column and keeps the rest", () => {
    const tests = [
      acceptedValues("status", ["open"]),
      relationships("status", "ref('a')", "id"),
      acceptedValues("other", ["x"]),
    ];

    const result = editTests({
      tests,
      column: "status",
      model: MODEL,
      request: { test: DbtGenericTests.ACCEPTED_VALUES },
      operation: TestOperation.DELETE,
      key: "",
    });

    expect(result).toEqual([tests[1], tests[2]]);
  });

  it("returns a new array and never changes the input", () => {
    const tests = [acceptedValues("status", ["open"])];
    const snapshot = structuredClone(tests);

    const result = editTests({
      tests,
      column: "status",
      model: MODEL,
      request: {
        test: DbtGenericTests.ACCEPTED_VALUES,
        accepted_values: ["x"],
      },
      operation: TestOperation.UPDATE,
      key: "",
    });

    expect(result).not.toBe(tests);
    expect(tests).toEqual(snapshot);
  });
});
