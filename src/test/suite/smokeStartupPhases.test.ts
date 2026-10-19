import { describe, expect, it } from "vitest";
import {
  parseRawPerfMarks,
  STARTUP_PHASE_MARKS,
  startupPhasesSinceLaunch,
} from "../smoke/startupPhases";

const HEADER = "Name\tTimestamp\tDelta\tTotal";

// Synthetic excerpt: three sources, a source with no rows, extra columns, extra whitespace and fractional offsets.
const REPORT = [
  "## Raw Perf Marks: main",
  HEADER,
  "code/didStartMain\t1000.4\t0\t0",
  "code/other\t1200\t1\t1",
  "",
  "## Extension Activation",
  "not a raw marks row",
  "",
  "## Raw Perf Marks: renderer",
  HEADER,
  "code/didStartWorkbench\t1500.6\t10\t10",
  "  code/willLoadExtensions  \t 1600 \t 1\t 1 \textra",
  "code/didLoadExtensions\t1900.4\t1\t1\tx\ty",
  "",
  "## Raw Perf Marks: localExtHost",
  HEADER,
  "",
].join("\n");

const LAUNCH = "1000";

describe("parseRawPerfMarks", () => {
  it("reads each raw-marks block into its own list of marks", () => {
    const marks = parseRawPerfMarks(REPORT);
    expect(Object.keys(marks)).toEqual(["main", "renderer", "localExtHost"]);
    expect(marks.main).toEqual([
      { name: "code/didStartMain", startTime: 1000.4 },
      { name: "code/other", startTime: 1200 },
    ]);
  });

  it("trims whitespace and ignores extra columns", () => {
    expect(parseRawPerfMarks(REPORT).renderer).toEqual([
      { name: "code/didStartWorkbench", startTime: 1500.6 },
      { name: "code/willLoadExtensions", startTime: 1600 },
      { name: "code/didLoadExtensions", startTime: 1900.4 },
    ]);
  });

  it("gives an empty list for a source block with no rows", () => {
    expect(parseRawPerfMarks(REPORT).localExtHost).toEqual([]);
  });

  it("gives no sources when the report has no raw-marks block", () => {
    expect(parseRawPerfMarks("## Extension Activation\nnothing here")).toEqual(
      {},
    );
  });
});

describe("startupPhasesSinceLaunch", () => {
  it("gives whole milliseconds from the launch, rounded, for marks that are present", () => {
    const phases = startupPhasesSinceLaunch(parseRawPerfMarks(REPORT), LAUNCH);
    expect(phases["main:code/didStartMain"]).toBe(0);
    expect(phases["renderer:code/didStartWorkbench"]).toBe(501);
    expect(phases["renderer:code/willLoadExtensions"]).toBe(600);
    expect(phases["renderer:code/didLoadExtensions"]).toBe(900);
  });

  it("gives null for a mark missing from the report, including a source with no rows", () => {
    const phases = startupPhasesSinceLaunch(parseRawPerfMarks(REPORT), LAUNCH);
    expect(
      phases["localExtHost:code/extHost/willConnectToRenderer"],
    ).toBeNull();
    expect(phases["localExtHost:code/extHost/ready"]).toBeNull();
  });

  it("gives null for a mark before the launch", () => {
    const report = [
      "## Raw Perf Marks: main",
      HEADER,
      "code/didStartMain\t999.9\t0\t0",
    ].join("\n");
    const phases = startupPhasesSinceLaunch(parseRawPerfMarks(report), LAUNCH);
    expect(phases["main:code/didStartMain"]).toBeNull();
  });

  it("gives all null for an unset, blank or malformed epoch", () => {
    const marks = parseRawPerfMarks(REPORT);
    for (const launch of [undefined, "", "   ", "soon", "0"]) {
      const phases = startupPhasesSinceLaunch(marks, launch);
      expect(Object.values(phases)).toEqual(
        STARTUP_PHASE_MARKS.map(() => null),
      );
    }
  });

  it("gives its keys in STARTUP_PHASE_MARKS order", () => {
    const phases = startupPhasesSinceLaunch(parseRawPerfMarks(REPORT), LAUNCH);
    expect(Object.keys(phases)).toEqual([...STARTUP_PHASE_MARKS]);
  });
});
