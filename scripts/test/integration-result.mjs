/**
 * @typedef {{ passing: number, pending: number }} Counts
 * @typedef {{ label: string, exitCode: number, seconds: number, log: string }} LabelRun
 * @typedef {{ label: string, ok: boolean, seconds: number, passing: number, pending: number, failing: number,
 *   expected: Counts | undefined, reasons: string[] }} LabelVerdict
 */

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

/** `text` without terminal colour and cursor escapes. */
export function stripAnsi(text) {
  return text.replace(ANSI, "");
}

/**
 * The totals of every mocha summary in `log`. A launch that ran nothing, or crashed before reporting, has no
 * summary and counts zero. Several launches in one log add up.
 * @returns {{ passing: number, pending: number, failing: number }}
 */
export function parseMochaCounts(log) {
  const counts = { passing: 0, pending: 0, failing: 0 };
  for (const line of stripAnsi(log).split(/\r?\n/)) {
    const match = /^\s*(\d+) (passing|pending|failing)\b/.exec(line);
    if (match) {
      counts[match[2]] += Number(match[1]);
    }
  }
  return counts;
}

/**
 * The label runs in a shard's output. The shard script brackets each label's output with
 * `FPU-LABEL-BEGIN <label>` and `FPU-LABEL-END <label> <exit code> <seconds>`; a label with no END line
 * (the container died) gets exit code 1.
 * @returns {LabelRun[]}
 */
export function parseShardOutput(output) {
  const runs = [];
  let current;
  for (const line of stripAnsi(output).split(/\r?\n/)) {
    const begin = /^FPU-LABEL-BEGIN (\S+)$/.exec(line);
    const end = /^FPU-LABEL-END (\S+) (\d+) (\d+)$/.exec(line);
    if (begin) {
      current = { label: begin[1], exitCode: 1, seconds: 0, lines: [] };
      runs.push(current);
    } else if (end && current?.label === end[1]) {
      current.exitCode = Number(end[2]);
      current.seconds = Number(end[3]);
      current = undefined;
    } else if (current) {
      current.lines.push(line);
    }
  }
  return runs.map(({ lines, ...run }) => ({ ...run, log: lines.join("\n") }));
}

/**
 * Judges one label against its expected counts. The label fails on any of: a non-zero exit, a failing test, a
 * passing count different from the expected one (a missing test or a silent skip), or more pending tests than
 * expected. Fewer pending tests than expected is fine as long as the passing count matches.
 * @param {LabelRun} run
 * @param {Counts | undefined} expected
 * @returns {LabelVerdict}
 */
export function judgeLabel(run, expected) {
  const { passing, pending, failing } = parseMochaCounts(run.log);
  const reasons = [];
  if (run.exitCode !== 0) {
    reasons.push(`exit code ${run.exitCode}`);
  }
  if (failing > 0) {
    reasons.push(`${failing} failing`);
  }
  if (!expected) {
    reasons.push("no expected counts in integration-expected.json");
  } else {
    if (passing !== expected.passing) {
      reasons.push(`passing ${passing}, expected ${expected.passing}`);
    }
    if (pending > expected.pending) {
      reasons.push(`pending ${pending}, expected at most ${expected.pending}`);
    }
  }
  return {
    label: run.label,
    ok: reasons.length === 0,
    seconds: run.seconds,
    passing,
    pending,
    failing,
    expected,
    reasons,
  };
}

/**
 * Expected counts per label from the parsed `integration-expected.json`. Add a test, or change how many a
 * launch skips, and update that file in the same change, or the Docker runner fails the label.
 * @returns {Record<string, Counts>}
 */
export function expectedCounts(json) {
  return Object.fromEntries(
    Object.entries(json).filter(([key]) => !key.startsWith("$")),
  );
}

/** One table of label, passing/pending against expected, seconds and ok/FAIL, then the reasons for each FAIL. */
export function formatSummary(verdicts) {
  const header = ["label", "passing", "pending", "seconds", "result"];
  const rows = verdicts.map((v) => [
    v.label,
    `${v.passing}/${v.expected?.passing ?? "?"}`,
    `${v.pending}/${v.expected?.pending ?? "?"}`,
    String(Math.round(v.seconds)),
    v.ok ? "ok" : "FAIL",
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );
  const line = (cells) =>
    cells
      .map((c, i) => c.padEnd(widths[i]))
      .join("  ")
      .trimEnd();
  const lines = [line(header), ...rows.map(line)];
  for (const v of verdicts.filter((x) => !x.ok)) {
    lines.push(`${v.label}: ${v.reasons.join("; ")}`);
  }
  return lines.join("\n");
}
