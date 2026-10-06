import { describe, expect, it } from "vitest";
import { buildGridInit, formatCell, mapColumnType } from "./columnTypeMapping";

describe("mapColumnType", () => {
  it("maps known agate types", () => {
    expect(mapColumnType("Text")).toBe("string");
    expect(mapColumnType("Integer")).toBe("number");
    expect(mapColumnType("BigInteger")).toBe("string");
    expect(mapColumnType("Number")).toBe("number");
  });

  it("treats an unknown or absent type as string rather than guessing", () => {
    expect(mapColumnType(null)).toBe("string");
    expect(mapColumnType(undefined)).toBe("string");
    expect(mapColumnType("some-unrecognized-type")).toBe("string");
  });
});

describe("buildGridInit", () => {
  it("gives unreported columns a string schema and renders their values as text", () => {
    const result = buildGridInit(
      ["n", "mixed", "flag", "obj"],
      [null, null, null, null],
      [
        { n: 1, mixed: 6, flag: true, obj: { a: 1 } },
        { n: 2.5, mixed: "x", flag: null, obj: null },
      ],
    );

    expect(result.schema).toEqual({
      n: "string",
      mixed: "string",
      flag: "string",
      obj: "string",
    });
    expect(result.rows).toEqual([
      { n: "1", mixed: "6", flag: "true", obj: '{"a":1}' },
      { n: "2.5", mixed: "x", flag: null, obj: null },
    ]);
  });

  it("keeps reported types, with BigInteger forced to string", () => {
    const result = buildGridInit(
      ["id", "amount"],
      ["BigInteger", "Number"],
      [{ id: "9007199254740993", amount: 1.5 }],
    );

    expect(result.schema).toEqual({ id: "string", amount: "number" });
    expect(result.rows).toEqual([{ id: "9007199254740993", amount: 1.5 }]);
  });
});

describe("formatCell", () => {
  it("shows numbers with every digit and no grouping, and missing values empty", () => {
    expect(formatCell(1234567.125)).toBe("1234567.125");
    expect(formatCell(0.1)).toBe("0.1");
    expect(formatCell(null)).toBe("");
    expect(formatCell(undefined)).toBe("");
    expect(formatCell("abc")).toBe("abc");
  });
});
