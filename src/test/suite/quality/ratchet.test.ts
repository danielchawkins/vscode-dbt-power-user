import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareMeasured,
  compareWithBase,
  countRustSuppressionsInText,
  METRICS,
  parseTrailers,
  SUPPRESSION_FILES,
} from "../../../../scripts/quality/ratchet.mjs";

const root = path.resolve(import.meta.dirname, "../../../..");

/**
 * Copies what `lint-ratchet` reads (its scripts, the crates, the sources it tags and the suppression files) into
 * .cache/ratchet-plants/<name>. The CLI finds its root from its own location, so it measures the copy.
 */
function copyRatchetTree(name: string): string {
  const dir = path.join(root, ".cache/ratchet-plants", name);
  rmSync(dir, { recursive: true, force: true });
  const skip = (src: string) => !/[\\/](node_modules|target|dist)$/.test(src);
  for (const entry of ["scripts", "crates", "src", "packages", "webviews"]) {
    cpSync(path.join(root, entry), path.join(dir, entry), {
      recursive: true,
      filter: skip,
    });
  }
  for (const file of Object.values(SUPPRESSION_FILES)) {
    cpSync(path.join(root, file), path.join(dir, file));
  }
  return dir;
}

/** `lint-ratchet` itself: `node scripts/quality/ratchet.mjs`, run in the tree at `dir`. */
function runRatchetCli(dir: string): { status: number | null; output: string } {
  const result = spawnSync(
    process.execPath,
    [path.join(dir, "scripts/quality/ratchet.mjs")],
    { cwd: dir, encoding: "utf8" },
  );
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

const metrics = [
  { key: "suppressions.host", kind: "ceiling", precision: 0 },
  { key: "coverage.host.lines", kind: "floor", precision: 2 },
];

describe("compareWithBase", () => {
  const base = { "suppressions.host": 10, "coverage.host.lines": 97.5 };

  it("accepts a loosened key that has a Ratchet-Loosen trailer", () => {
    const messages =
      "build: delete covered code\n\nRatchet-Loosen: coverage.host.lines covered code deleted\n";

    const result = compareWithBase(
      metrics,
      base,
      { "suppressions.host": 10, "coverage.host.lines": 97.1 },
      messages,
    );

    expect(result.rejected).toEqual([]);
    expect(result.accepted).toEqual([
      {
        key: "coverage.host.lines",
        from: 97.5,
        to: 97.1,
        reason: "covered code deleted",
      },
    ]);
  });

  it("rejects a loosened key without a trailer, even when another key has one", () => {
    const messages = "fix: x\n\nRatchet-Loosen: coverage.host.lines reason\n";

    const result = compareWithBase(
      metrics,
      base,
      { "suppressions.host": 11, "coverage.host.lines": 97.5 },
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
      { key: "coverage.host.lines", from: 97.5, to: undefined },
    ]);
  });

  it("skips every key when the base has no ceilings.json", () => {
    const result = compareWithBase(
      metrics,
      undefined,
      { "suppressions.host": 50, "coverage.host.lines": 1 },
      "",
    );

    expect(result.rejected).toEqual([]);
    expect(result.skipped).toEqual([
      "suppressions.host",
      "coverage.host.lines",
    ]);
  });

  it("skips a key that is new in the head", () => {
    const result = compareWithBase(
      metrics,
      { "suppressions.host": 10 },
      { "suppressions.host": 9, "coverage.host.lines": 90 },
      "",
    );

    expect(result.rejected).toEqual([]);
    expect(result.skipped).toEqual(["coverage.host.lines"]);
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
      { "suppressions.host": 3, "coverage.host.lines": 99 },
      "",
    );

    expect(result).toEqual({ accepted: [], rejected: [], skipped: [] });
  });
});

describe("compareMeasured", () => {
  const ceilings = { "suppressions.host": 10, "coverage.host.lines": 97.5 };

  it("passes when every measured value equals its entry after rounding", () => {
    expect(
      compareMeasured(metrics, ceilings, {
        "suppressions.host": 10,
        "coverage.host.lines": 97.509,
      }),
    ).toEqual({ worse: [], better: [], missing: [] });
  });

  it("reports worse, better and missing values", () => {
    const result = compareMeasured(
      metrics,
      { "suppressions.host": 10 },
      { "suppressions.host": 11, "coverage.host.lines": 90 },
    );
    expect(result.worse).toEqual([
      { key: "suppressions.host", value: 11, entry: 10 },
    ]);
    expect(result.missing).toEqual([{ key: "coverage.host.lines", value: 90 }]);

    expect(
      compareMeasured(metrics, ceilings, {
        "suppressions.host": 9,
        "coverage.host.lines": 97.5,
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

describe("suppression ratchet keys", () => {
  type Suppressions = Record<string, Record<string, { count: number }>>;
  type Inventory = Record<
    string,
    Record<string, { engine: string; from: string }>
  >;
  const readJson = <T>(file: string): T =>
    JSON.parse(readFileSync(path.join(root, file), "utf8")) as T;

  it("maps exactly the four suppression keys to their files", () => {
    expect(SUPPRESSION_FILES).toEqual({
      "suppressions.host": "eslint-suppressions.json",
      "suppressions.webview": "webviews/eslint-suppressions.json",
      "oxlintSuppressions.host": "oxlint-suppressions.json",
      "oxlintSuppressions.webview": "webviews/oxlint-suppressions.json",
    });
  });

  it("measures each suppression metric as the total of its own file", () => {
    for (const metric of METRICS.filter((m) => m.key in SUPPRESSION_FILES)) {
      const file =
        SUPPRESSION_FILES[metric.key as keyof typeof SUPPRESSION_FILES];
      const total = Object.values(readJson<Suppressions>(file))
        .flatMap((rules) => Object.values(rules))
        .reduce((sum, { count }) => sum + count, 0);
      expect(metric.measure(), metric.key).toBe(total);
    }
  });

  it("keeps oxlint and held rules out of eslint-suppressions.json after pruning", () => {
    const inventory = readJson<Inventory>("lint/fixtures/inventory.json");
    for (const [workspace, file] of [
      ["host", "eslint-suppressions.json"],
      ["webview", "webviews/eslint-suppressions.json"],
    ]) {
      const moved = new Set(
        Object.values(inventory[workspace])
          .filter(({ engine }) => engine === "oxlint" || engine === "held")
          .map(({ from }) => from),
      );
      const ruleKeys = new Set(
        Object.values(readJson<Suppressions>(file)).flatMap((rules) =>
          Object.keys(rules),
        ),
      );
      expect([...ruleKeys].filter((rule) => moved.has(rule))).toEqual([]);
    }
  });
});

describe("Rust suppression ratchet", () => {
  const ceilings = JSON.parse(
    readFileSync(path.join(root, "scripts/quality/ceilings.json"), "utf8"),
  ) as Record<string, number>;
  const rustMetrics = METRICS.filter((metric) =>
    metric.key.startsWith("rustSuppressions."),
  );

  it("control: the unmodified crates pass the ratchet", () => {
    const measured = Object.fromEntries(
      rustMetrics.map((metric) => [metric.key, metric.measure()]),
    );
    expect(compareMeasured(rustMetrics, ceilings, measured)).toEqual({
      worse: [],
      better: [],
      missing: [],
    });
  });

  it(
    "control: the lint-ratchet CLI passes on an unmodified copy of the tree",
    { timeout: 300_000 },
    () => {
      const run = runRatchetCli(copyRatchetTree("ratchet-control"));
      expect(run.status, run.output).toBe(0);
    },
  );

  it(
    "plant: the lint-ratchet CLI fails on one extra #[expect] in a copied tree",
    { timeout: 300_000 },
    () => {
      const dir = copyRatchetTree("ratchet-plant");
      appendFileSync(
        path.join(dir, "crates/graph-layout/src/lib.rs"),
        '\n#[expect(dead_code, reason = "planted")]\nfn planted() {}\n',
      );
      const run = runRatchetCli(dir);
      expect(run.status).not.toBe(0);
      expect(run.output).toContain("rustSuppressions.graph-layout");
    },
  );

  it("counts a suppression inside cfg_attr", () => {
    expect(
      countRustSuppressionsInText(
        "#[cfg_attr(test, expect(dead_code))]\nfn f() {}\n",
      ),
    ).toBe(1);
  });

  it("does not count a suppression quoted in a comment or a string", () => {
    const text = [
      "// #[expect(dead_code)]",
      "/* outer /* #[allow(dead_code)] */ still a comment #[expect(x)] */",
      'const S: &str = "#[expect(dead_code)]";',
      'const R: &str = r#"#[allow(dead_code)]"#;',
      "const Q: char = '\"';",
      "fn f<'a>(x: &'a str) -> &'a str { x }",
      "",
    ].join("\n");
    expect(countRustSuppressionsInText(text)).toBe(0);
  });

  it("counts the real suppressions beside the quoted ones", () => {
    expect(
      countRustSuppressionsInText(
        '// #[expect(a)]\n#[expect(b, reason = "x")]\nfn f() {}\n',
      ),
    ).toBe(1);
  });
});
