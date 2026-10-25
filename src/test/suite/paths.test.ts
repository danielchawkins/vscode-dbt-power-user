import { describe, expect, it } from "vitest";
import { isAtOrBelow, isStrictlyBelow } from "../../core/paths";

describe("isAtOrBelow", () => {
  it("accepts the root itself", () => {
    expect(isAtOrBelow("/a/proj", "/a/proj")).toBe(true);
  });

  it("accepts a child and a deeper descendant", () => {
    expect(isAtOrBelow("/a/proj", "/a/proj/models")).toBe(true);
    expect(isAtOrBelow("/a/proj", "/a/proj/models/x.sql")).toBe(true);
  });

  it("rejects a sibling that shares a prefix with the root", () => {
    expect(isAtOrBelow("/a/proj", "/a/project")).toBe(false);
    expect(isAtOrBelow("/a/proj", "/a/project/models/x.sql")).toBe(false);
    expect(isAtOrBelow("/a/proj", "/a/proj2/x.sql")).toBe(false);
  });

  it("accepts a child whose name starts with two dots", () => {
    expect(isAtOrBelow("/a/proj", "/a/proj/..x")).toBe(true);
    expect(isAtOrBelow("/a/proj", "/a/proj/..x/models/m.sql")).toBe(true);
  });

  it("rejects paths that escape the root with ..", () => {
    expect(isAtOrBelow("/a/proj", "/a/proj/..")).toBe(false);
    expect(isAtOrBelow("/a/proj", "/a/proj/../x.sql")).toBe(false);
    expect(isAtOrBelow("/a/proj", "/a")).toBe(false);
    expect(isAtOrBelow("/a/proj", "/")).toBe(false);
  });

  it("ignores trailing separators on the root or the path", () => {
    expect(isAtOrBelow("/a/proj/", "/a/proj")).toBe(true);
    expect(isAtOrBelow("/a/proj", "/a/proj/")).toBe(true);
    expect(isAtOrBelow("/a/proj/", "/a/proj/x.sql")).toBe(true);
    expect(isAtOrBelow("/a/proj/", "/a/project/")).toBe(false);
  });

  it("treats the filesystem root as containing everything", () => {
    expect(isAtOrBelow("/", "/")).toBe(true);
    expect(isAtOrBelow("/", "/a/proj/x.sql")).toBe(true);
  });
});

describe("isStrictlyBelow", () => {
  it("rejects the root itself", () => {
    expect(isStrictlyBelow("/a/proj", "/a/proj")).toBe(false);
    expect(isStrictlyBelow("/a/proj/", "/a/proj")).toBe(false);
  });

  it("accepts a child and a deeper descendant", () => {
    expect(isStrictlyBelow("/a/proj", "/a/proj/models")).toBe(true);
    expect(isStrictlyBelow("/a/proj", "/a/proj/models/x.sql")).toBe(true);
  });

  it("rejects a sibling that shares a prefix with the root", () => {
    expect(isStrictlyBelow("/a/proj", "/a/project")).toBe(false);
    expect(isStrictlyBelow("/a/proj", "/a/project/x.sql")).toBe(false);
  });

  it("accepts a child whose name starts with two dots", () => {
    expect(isStrictlyBelow("/a/proj", "/a/proj/..x")).toBe(true);
    expect(isStrictlyBelow("/a/proj", "/a/proj/..x/m.sql")).toBe(true);
  });

  it("rejects paths that escape the root with ..", () => {
    expect(isStrictlyBelow("/a/proj", "/a/proj/..")).toBe(false);
    expect(isStrictlyBelow("/a/proj", "/a/proj/../x.sql")).toBe(false);
    expect(isStrictlyBelow("/a/proj", "/a")).toBe(false);
  });

  it("treats a trailing separator on the path as the root itself", () => {
    expect(isStrictlyBelow("/a/proj", "/a/proj/")).toBe(false);
    expect(isStrictlyBelow("/a/proj/", "/a/proj/x.sql")).toBe(true);
  });
});
