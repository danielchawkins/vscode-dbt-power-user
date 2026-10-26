import { describe, expect, it } from "vitest";
import { isAtOrBelow, isStrictlyBelow } from "../../core/paths";

describe("isAtOrBelow", () => {
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
