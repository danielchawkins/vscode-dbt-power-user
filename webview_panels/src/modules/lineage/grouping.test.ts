import type { lineage } from "@fusion-power-user/webview-contract";
import { describe, expect, it } from "vitest";
import {
  bucketNeighbours,
  groupedNeighbours,
  groupLabel,
  groupNodeId,
  parseGroupNodeId,
  savedGroupKey,
  shortGroupKey,
} from "./grouping";

const table = (
  id: string,
  over: Partial<lineage.LineageTable> = {},
): lineage.LineageTable => ({
  table: id,
  label: id,
  nodeType: "model",
  childCount: 0,
  parentCount: 0,
  tests: [],
  ...over,
});

const inFolder = (id: string, folder: string) =>
  table(id, { path: `${folder}/${id}.sql`, rootPackage: true });

describe("bucketNeighbours", () => {
  it("buckets by the full folder of each path", () => {
    expect(
      bucketNeighbours(
        [
          inFolder("a", "models/marts/finance"),
          inFolder("b", "models/marts/finance"),
          inFolder("c", "models/marts/finance/nested"),
          inFolder("d", "models/marts/finance/nested"),
        ],
        new Set(),
        10,
      ),
    ).toEqual({
      buckets: [
        { key: "models/marts/finance", members: ["a", "b"] },
        { key: "models/marts/finance/nested", members: ["c", "d"] },
      ],
      loose: [],
    });
  });

  it("prefixes a folder outside the root package with pkg:, and buckets a node with no path by type", () => {
    const grouped = bucketNeighbours(
      [
        table("u1", { path: "macros/u1.sql" }),
        table("u2", { path: "macros/u2.sql" }),
        table("s1", { nodeType: "seed" }),
        table("s2", { nodeType: "seed" }),
      ],
      new Set(),
      10,
    );
    expect(grouped).toEqual({
      buckets: [
        { key: "type:seed", members: ["s1", "s2"] },
        { key: "pkg:macros", members: ["u1", "u2"] },
      ],
      loose: [],
    });
  });

  it("leaves out drawn neighbours", () => {
    expect(
      bucketNeighbours(
        [inFolder("a", "models/x"), inFolder("b", "models/x")],
        new Set(["a"]),
        10,
      ),
    ).toEqual({ buckets: [], loose: ["b"] });
  });

  it("sends a folder with a single member to loose", () => {
    expect(
      bucketNeighbours(
        [
          inFolder("x", "models/a"),
          inFolder("y", "models/b"),
          inFolder("z", "models/b"),
        ],
        new Set(),
        10,
      ),
    ).toEqual({
      buckets: [{ key: "models/b", members: ["y", "z"] }],
      loose: ["x"],
    });
  });

  it("orders members by layer, then by refName or label", () => {
    const layered = (id: string, over: Partial<lineage.LineageTable>) =>
      table(id, { path: "models/m/x.sql", rootPackage: true, ...over });
    const grouped = bucketNeighbours(
      [
        layered("m1", { layer: "marts", label: "m1" }),
        layered("s2", { layer: "staging", label: "zzz", refName: "aaa" }),
        layered("s3", { layer: "staging", label: "bbb" }),
        layered("n4", { label: "a0" }),
        layered("o5", { layer: "snapshots", label: "a1" }),
        layered("i6", { layer: "intermediate", label: "i" }),
      ],
      new Set(),
      10,
    );
    expect(grouped?.buckets[0]?.members).toEqual([
      "s2",
      "s3",
      "i6",
      "m1",
      "o5",
      "n4",
    ]);
  });

  it("is undefined when the buckets and loose neighbours would not fit the cap", () => {
    const neighbours = [
      inFolder("a", "models/a"),
      inFolder("b", "models/a"),
      inFolder("c", "models/b"),
      inFolder("d", "models/b"),
      inFolder("e", "models/c"),
    ];
    expect(bucketNeighbours(neighbours, new Set(), 3)).toBeDefined();
    expect(bucketNeighbours(neighbours, new Set(), 2)).toBeUndefined();
  });
});

describe("groupedNeighbours", () => {
  it("draws the loose neighbours and the members of each open bucket", () => {
    const groups = {
      buckets: [
        { key: "f", members: ["a", "b"] },
        { key: "g", members: ["c", "d"] },
      ],
      loose: ["x"],
      open: { g: 2 },
    };
    expect(groupedNeighbours(groups)).toEqual(["x", "c", "d"]);
  });

  it("draws only the first members of an open bucket that its count names", () => {
    const groups = {
      buckets: [{ key: "g", members: ["c", "d", "e"] }],
      loose: [],
      open: { g: 2 },
    };
    expect(groupedNeighbours(groups)).toEqual(["c", "d"]);
  });
});

describe("parseGroupNodeId", () => {
  it("reads back the expansion and bucket a group node ID was made from", () => {
    for (const [expansion, key] of [
      ["c:hub", "models/a"],
      ["p:hub", "pkg:macros"],
      ["c:hub", "type:seed"],
      ["c:hub", ""],
      ["c:hub", "a|b"],
    ]) {
      expect(parseGroupNodeId(groupNodeId(expansion, key))).toEqual([
        expansion,
        key,
      ]);
    }
  });

  it("rejects an ID that is not a group node ID", () => {
    expect(parseGroupNodeId("hub")).toBeUndefined();
    expect(parseGroupNodeId("group:")).toBeUndefined();
    expect(parseGroupNodeId("group:|models/a")).toBeUndefined();
    expect(parseGroupNodeId("group:c:hub")).toBeUndefined();
  });
});

describe("shortGroupKey", () => {
  it("matches the pinned vectors", () => {
    expect(shortGroupKey("c:a", "a")).toBe("c:a|#1r9wi7g");
    expect(shortGroupKey("c:a", "foobar")).toBe("c:a|#1h5yxyg");
  });
});

describe("savedGroupKey", () => {
  // "group:c:hub|" is 12 characters, so a key of length n - 12 makes an ID of length n.
  const idOf = (length: number) =>
    groupNodeId("c:hub", "k".repeat(length - "group:c:hub|".length));

  it("keeps an ID of 200 characters", () => {
    const id = idOf(200);
    expect(id).toHaveLength(200);
    expect(savedGroupKey(id, 200)).toBe(id);
  });

  it("shortens an ID of 201 characters to its short key", () => {
    const id = idOf(201);
    expect(savedGroupKey(id, 200)).toBe(
      shortGroupKey("c:hub", "k".repeat(189)),
    );
  });

  it("is undefined when the expansion alone makes the short key too long", () => {
    const id = groupNodeId("e".repeat(195), "a");
    expect(id.length).toBeGreaterThan(200);
    expect(savedGroupKey(id, 200)).toBeUndefined();
  });

  it("is undefined for a long string that is not a group node ID", () => {
    expect(savedGroupKey("x".repeat(201), 200)).toBeUndefined();
  });
});

describe("groupLabel", () => {
  it("labels a folder by its last segment, with or without the pkg: prefix", () => {
    expect(groupLabel("models/marts/finance")).toBe("finance");
    expect(groupLabel("pkg:macros/utils")).toBe("utils");
    expect(groupLabel("pkg:macros")).toBe("macros");
  });

  it("labels a node with no path by its resource type", () => {
    expect(groupLabel("type:seed")).toBe("seed");
  });

  it("labels a file at the root of a package", () => {
    expect(groupLabel("")).toBe("(root)");
  });
});
