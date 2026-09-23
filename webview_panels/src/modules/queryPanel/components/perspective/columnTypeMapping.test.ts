import { describe, expect, it } from "vitest";
import { buildPerspectiveTableInit, mapColumnType } from "./columnTypeMapping";

describe("mapColumnType", () => {
  it("maps known agate types", () => {
    expect(mapColumnType("Text")).toBe("string");
    expect(mapColumnType("Integer")).toBe("float");
    expect(mapColumnType("BigInteger")).toBe("string");
    expect(mapColumnType("Number")).toBe("float");
  });

  it("treats an unknown or absent type as string rather than guessing", () => {
    expect(mapColumnType(null)).toBe("string");
    expect(mapColumnType(undefined)).toBe("string");
    expect(mapColumnType("some-unrecognized-type")).toBe("string");
  });
});

describe("buildPerspectiveTableInit", () => {
  it("hands Perspective the row data directly when every column type is unknown", () => {
    const data = [{ int_col: 1, str_col: "x", bool_col: true }];

    const result = buildPerspectiveTableInit(
      ["int_col", "str_col", "bool_col"],
      [null, null, null],
      data,
    );

    expect(result).toBe(data);
  });

  it("builds an explicit schema, with BigInteger forced to string, when a type is known", () => {
    const data = [{ id: "9007199254740993", name: "a" }];

    const result = buildPerspectiveTableInit(
      ["id", "name"],
      ["BigInteger", null],
      data,
    );

    expect(result).toEqual({ id: "string", name: "string" });
  });
});
