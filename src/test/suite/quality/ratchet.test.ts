import { describe, expect, it } from "vitest";
import {
  compareMeasured,
  compareWithBase,
  parseTrailers,
} from "../../../../scripts/quality/ratchet.mjs";

const metrics = [
  { key: "suppressions.host", kind: "ceiling", precision: 0 },
  { key: "typeCoverage.host", kind: "floor", precision: 2 },
];

describe("compareWithBase", () => {
  const base = { "suppressions.host": 10, "typeCoverage.host": 97.5 };

  it("accepts a loosened key that has a Ratchet-Loosen trailer", () => {
    const messages =
      "build: delete covered code\n\nRatchet-Loosen: typeCoverage.host covered code deleted\n";

    const result = compareWithBase(
      metrics,
      base,
      { "suppressions.host": 10, "typeCoverage.host": 97.1 },
      messages,
    );

    expect(result.rejected).toEqual([]);
    expect(result.accepted).toEqual([
      {
        key: "typeCoverage.host",
        from: 97.5,
        to: 97.1,
        reason: "covered code deleted",
      },
    ]);
  });

  it("rejects a loosened key without a trailer, even when another key has one", () => {
    const messages = "fix: x\n\nRatchet-Loosen: typeCoverage.host reason\n";

    const result = compareWithBase(
      metrics,
      base,
      { "suppressions.host": 11, "typeCoverage.host": 97.5 },
      messages,
    );

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      { key: "suppressions.host", from: 10, to: 11 },
    ]);
  });

  it("rejects a key removed from the head without a trailer", () => {
    const result = compareWithBase(
      metrics,
      base,
      { "suppressions.host": 10 },
      "",
    );

    expect(result.rejected).toEqual([
      { key: "typeCoverage.host", from: 97.5, to: undefined },
    ]);
  });

  it("skips every key when the base has no ceilings.json", () => {
    const result = compareWithBase(
      metrics,
      undefined,
      { "suppressions.host": 50, "typeCoverage.host": 1 },
      "",
    );

    expect(result.rejected).toEqual([]);
    expect(result.skipped).toEqual(["suppressions.host", "typeCoverage.host"]);
  });

  it("skips a key that is new in the head", () => {
    const result = compareWithBase(
      metrics,
      { "suppressions.host": 10 },
      { "suppressions.host": 9, "typeCoverage.host": 90 },
      "",
    );

    expect(result.rejected).toEqual([]);
    expect(result.skipped).toEqual(["typeCoverage.host"]);
  });

  it("rejects a lowered coverage floor and a raised size budget without a trailer", () => {
    const nested = { coverage: { host: { lines: 80 } }, size: { "a.js": 100 } };
    const loosened = {
      coverage: { host: { lines: 70 } },
      size: { "a.js": 120 },
    };

    const result = compareWithBase(metrics, nested, loosened, "");
    expect(
      result.rejected.map((change: { key: string }) => change.key),
    ).toEqual(["coverage.host.lines", "size.a.js"]);

    const trailers =
      "Ratchet-Loosen: coverage.host.lines r\nRatchet-Loosen: size.a.js r\n";
    const accepted = compareWithBase(metrics, nested, loosened, trailers);
    expect(accepted.rejected).toEqual([]);
    expect(accepted.accepted).toHaveLength(2);
  });

  it("accepts a raised coverage floor and a lowered size budget", () => {
    const result = compareWithBase(
      metrics,
      { coverage: { host: { lines: 80 } }, size: { "a.js": 100 } },
      { coverage: { host: { lines: 90 } }, size: { "a.js": 90 } },
      "",
    );

    expect(result).toEqual({ accepted: [], rejected: [], skipped: [] });
  });

  it("accepts a tightened key without a trailer", () => {
    const result = compareWithBase(
      metrics,
      base,
      { "suppressions.host": 3, "typeCoverage.host": 99 },
      "",
    );

    expect(result).toEqual({ accepted: [], rejected: [], skipped: [] });
  });
});

describe("compareMeasured", () => {
  const ceilings = { "suppressions.host": 10, "typeCoverage.host": 97.5 };

  it("passes when every measured value equals its entry after rounding", () => {
    expect(
      compareMeasured(metrics, ceilings, {
        "suppressions.host": 10,
        "typeCoverage.host": 97.509,
      }),
    ).toEqual({ worse: [], better: [], missing: [] });
  });

  it("reports worse, better and missing values", () => {
    const result = compareMeasured(
      metrics,
      { "suppressions.host": 10 },
      { "suppressions.host": 11, "typeCoverage.host": 90 },
    );
    expect(result.worse).toEqual([
      { key: "suppressions.host", value: 11, entry: 10 },
    ]);
    expect(result.missing).toEqual([{ key: "typeCoverage.host", value: 90 }]);

    expect(
      compareMeasured(metrics, ceilings, {
        "suppressions.host": 9,
        "typeCoverage.host": 97.5,
      }).better,
    ).toEqual([{ key: "suppressions.host", value: 9, entry: 10 }]);
  });
});

describe("parseTrailers", () => {
  it("reads one trailer per line and ignores a trailer with no reason", () => {
    const trailers = parseTrailers(
      "a\n\nRatchet-Loosen: a.b first reason\nRatchet-Loosen: c.d\nRatchet-Loosen: e.f second\n",
    );

    expect([...trailers]).toEqual([
      ["a.b", "first reason"],
      ["e.f", "second"],
    ]);
  });
});
