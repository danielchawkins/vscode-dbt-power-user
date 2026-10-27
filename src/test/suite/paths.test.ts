import { describe, expect, it } from "vitest";
import {
  isAtOrBelow,
  isStrictlyBelow,
  serverIgnoresPath,
} from "../../core/paths";

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

describe("serverIgnoresPath", () => {
  it("covers the target directory and the default log directory", () => {
    expect(
      serverIgnoresPath(
        "/a/proj",
        "/a/proj/target",
        "/a/proj/target/manifest.json",
      ),
    ).toBe(true);
    expect(
      serverIgnoresPath(
        "/a/proj",
        "/a/proj/target",
        "/a/proj/logs/dbt-lsp.log",
      ),
    ).toBe(true);
  });

  it("keeps project files, including sibling names that share a prefix", () => {
    expect(
      serverIgnoresPath("/a/proj", "/a/proj/target", "/a/proj/models/a.sql"),
    ).toBe(false);
    expect(
      serverIgnoresPath("/a/proj", "/a/proj/target", "/a/proj/target2/a.sql"),
    ).toBe(false);
    expect(
      serverIgnoresPath("/a/proj", "/a/proj/target", "/a/proj/logsx/a.log"),
    ).toBe(false);
  });

  it("follows a configured target path, and no longer ignores the default one", () => {
    expect(
      serverIgnoresPath("/a/proj", "/a/proj/out", "/a/proj/out/x.json"),
    ).toBe(true);
    expect(
      serverIgnoresPath("/a/proj", "/a/proj/out", "/a/proj/target/x.json"),
    ).toBe(false);
  });

  it("never excludes the whole project when the target path is the root", () => {
    expect(
      serverIgnoresPath("/a/proj", "/a/proj", "/a/proj/models/a.sql"),
    ).toBe(false);
  });
});
