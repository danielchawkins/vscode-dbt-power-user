import type { lineage } from "@fusion-power-user/webview-contract";
import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { endMark, relationEnds, relationTitle } from "./relationshipMarks";

describe("relationEnds", () => {
  it("reads the many side of a many-to-one as the from end", () => {
    expect(relationEnds("many-to-one")).toEqual({
      from: "many",
      to: "one",
    });
  });

  it("reads the many side of a one-to-many as the to end", () => {
    expect(relationEnds("one-to-many")).toEqual({
      from: "one",
      to: "many",
    });
  });

  it("marks both ends many for many-to-many and both one for one-to-one", () => {
    expect(relationEnds("many-to-many")).toEqual({
      from: "many",
      to: "many",
    });
    expect(relationEnds("one-to-one")).toEqual({
      from: "one",
      to: "one",
    });
  });

  it("treats an unrecognised cardinality as one on both ends", () => {
    expect(relationEnds("bogus")).toEqual({ from: "one", to: "one" });
  });
});

describe("endMark", () => {
  it("draws a bar across the line six pixels off a left-side handle", () => {
    expect(endMark("one", 100, 50, Position.Left)).toBe("M94,56 L94,44");
  });

  it("draws a bar six pixels off a right-side handle", () => {
    expect(endMark("one", 100, 50, Position.Right)).toBe("M106,44 L106,56");
  });

  it("draws a bar above a top handle", () => {
    expect(endMark("one", 100, 50, Position.Top)).toBe("M94,44 L106,44");
  });

  it("fans a crow's foot in from three toes on a left-side handle", () => {
    expect(endMark("many", 100, 50, Position.Left)).toBe(
      "M100,44 L91,50 M100,50 L91,50 M100,56 L91,50",
    );
  });

  it("fans a crow's foot in from three toes on a right-side handle", () => {
    expect(endMark("many", 100, 50, Position.Right)).toBe(
      "M100,56 L109,50 M100,50 L109,50 M100,44 L109,50",
    );
  });
});

describe("relationTitle", () => {
  const ref = (source: lineage.RefSource): lineage.LineageRef => ({
    id: "r",
    from: { table: "child", columns: ["a", "b"] },
    to: { table: "hub", columns: ["x"] },
    cardinality: "many-to-one",
    source,
  });

  it("names the columns from -> to", () => {
    expect(relationTitle(ref("meta")).columns).toBe("a, b -> x");
  });

  it.each([
    ["meta", "declared in meta.relationships"],
    ["test", "relationships test"],
    ["contract", "contract foreign key"],
    ["semantic", "semantic entities"],
    ["inferred", "inferred from column names"],
  ] as const)("labels a %s relationship's source", (source, label) => {
    expect(relationTitle(ref(source)).source).toBe(label);
  });
});
