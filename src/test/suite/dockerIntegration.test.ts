import { describe, expect, it } from "vitest";
import expectedJson from "../../../scripts/test/integration-expected.json";
import {
  LABELS,
  VSIX_LABELS,
} from "../../../scripts/test/integration-layout.mjs";
import {
  expectedCounts,
  formatSummary,
  judgeLabel,
  parseMochaCounts,
  parseShardOutput,
} from "../../../scripts/test/integration-result.mjs";

const expected = { passing: 4, pending: 5 };
const run = (log: string, exitCode = 0) => ({
  label: "native-baseline",
  exitCode,
  seconds: 7,
  log,
});

describe("judgeLabel", () => {
  it("passes a label with the expected counts", () => {
    const verdict = judgeLabel(
      run("  4 passing (3s)\n  5 pending\n"),
      expected,
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.reasons).toEqual([]);
  });

  it("accepts fewer pending tests than expected", () => {
    expect(
      judgeLabel(run("  4 passing (3s)\n  1 pending\n"), expected).ok,
    ).toBe(true);
  });

  it("fails a silent skip, where everything is pending and the exit code is 0", () => {
    const verdict = judgeLabel(run("  9 pending\n"), expected);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons).toContain("passing 0, expected 4");
    expect(verdict.reasons).toContain("pending 9, expected at most 5");
  });

  it("fails a missing test", () => {
    const verdict = judgeLabel(
      run("  3 passing (3s)\n  5 pending\n"),
      expected,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons).toEqual(["passing 3, expected 4"]);
  });

  it("fails an extra passing test until the expected file is updated", () => {
    const verdict = judgeLabel(
      run("  5 passing (3s)\n  5 pending\n"),
      expected,
    );
    expect(verdict.reasons).toEqual(["passing 5, expected 4"]);
  });

  it("fails an extra failure and a non-zero exit", () => {
    const verdict = judgeLabel(
      run("  4 passing (3s)\n  5 pending\n  1 failing\n", 1),
      expected,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons).toEqual(["exit code 1", "1 failing"]);
  });

  it("fails a label with no expected counts", () => {
    expect(judgeLabel(run("  4 passing\n"), undefined).ok).toBe(false);
  });

  it("reads ANSI-coloured mocha output", () => {
    const log =
      "\u001b[92m  ✔\u001b[0m\u001b[90m a test\u001b[0m\n" +
      "\u001b[92m  4 passing\u001b[0m\u001b[90m (3s)\u001b[0m\n" +
      "\u001b[36m  5 pending\u001b[0m\n";
    expect(parseMochaCounts(log)).toEqual({
      passing: 4,
      pending: 5,
      failing: 0,
    });
    expect(judgeLabel(run(log), expected).ok).toBe(true);
  });
});

describe("parseMochaCounts", () => {
  it("adds the summaries of several launches", () => {
    expect(
      parseMochaCounts("  2 passing (1s)\n  1 pending\n  3 passing (1s)\n"),
    ).toEqual({ passing: 5, pending: 1, failing: 0 });
  });

  it("ignores test titles that mention counts", () => {
    expect(parseMochaCounts("    ✔ reports 3 passing checks\n")).toEqual({
      passing: 0,
      pending: 0,
      failing: 0,
    });
  });
});

describe("parseShardOutput", () => {
  it("splits labels and reads exit code and seconds", () => {
    const runs = parseShardOutput(
      [
        "FPU-LABEL-BEGIN a",
        "  1 passing",
        "FPU-LABEL-END a 0 12",
        "FPU-LABEL-BEGIN b",
        "  2 passing",
        "FPU-LABEL-END b 1 5",
      ].join("\n"),
    );
    expect(runs.map((r) => [r.label, r.exitCode, r.seconds])).toEqual([
      ["a", 0, 12],
      ["b", 1, 5],
    ]);
    expect(parseMochaCounts(runs[1].log).passing).toBe(2);
  });

  it("fails a label whose container died before the end marker", () => {
    const [only] = parseShardOutput("FPU-LABEL-BEGIN a\n  1 passing\n");
    expect(only.exitCode).toBe(1);
  });
});

describe("formatSummary", () => {
  it("prints a row per label and the reasons for failures", () => {
    const table = formatSummary([
      judgeLabel(run("  4 passing\n  5 pending\n"), expected),
      judgeLabel({ ...run("  9 pending\n"), label: "x" }, expected),
    ]);
    expect(table).toContain("native-baseline  4/4      5/5");
    expect(table).toMatch(/x\s+0\/4\s+9\/5\s+7\s+FAIL/);
    expect(table).toContain("x: passing 0, expected 4");
  });
});

describe("integration-expected.json", () => {
  it("has counts for every label", () => {
    expect(Object.keys(expectedCounts(expectedJson)).sort()).toEqual(
      [...LABELS, ...VSIX_LABELS].sort(),
    );
  });
});
