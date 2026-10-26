import { describe, expect, it } from "vitest";
import { signalExitCode } from "../../../../scripts/smoke/launchSupport.mjs";
import {
  busiestProcesses,
  hostProcessLines,
} from "../../../../scripts/smoke/watchdog.mjs";

describe("hostProcessLines", () => {
  it("keeps the lines under the install bundle on Linux", () => {
    const ps = [
      "  1  0 0.0 00:09 /usr/share/cursor/cursor --type=renderer",
      "  2  1 0.0 00:09 /usr/bin/bash",
    ].join("\n");
    expect(
      hostProcessLines(ps, { platform: "linux", bundle: "/usr/share/cursor" }),
    ).toEqual(["  1  0 0.0 00:09 /usr/share/cursor/cursor --type=renderer"]);
  });

  it("keeps lines that name the host or its tools elsewhere", () => {
    const ps = [
      "  1 0 0.0 00:09 /Applications/Cursor.app/Contents/MacOS/Cursor",
      "  2 1 0.0 00:09 /usr/bin/bash",
    ].join("\n");
    expect(
      hostProcessLines(ps, {
        platform: "darwin",
        bundle: "/Applications/Cursor.app",
      }),
    ).toEqual([
      "  1 0 0.0 00:09 /Applications/Cursor.app/Contents/MacOS/Cursor",
    ]);
  });
});

describe("busiestProcesses", () => {
  it("returns the two busiest bundle or helper processes by CPU", () => {
    const hostLines = [
      "10 1 5.0 00:10 /Applications/Cursor.app/Contents/MacOS/Cursor",
      "11 1 40.0 00:10 /Applications/Cursor.app/Contents/Frameworks/Cursor Helper (Renderer)",
      "12 1 20.0 00:10 /Applications/Cursor.app/Contents/Frameworks/Cursor Helper",
      "13 1 90.0 00:10 /usr/bin/other",
    ];
    const busiest: string[][] = busiestProcesses(
      hostLines,
      "/Applications/Cursor.app",
    );
    expect(busiest.map(([pid]) => pid)).toEqual(["11", "12"]);
  });
});

describe("signalExitCode", () => {
  it("is 128 plus the signal number", () => {
    expect(signalExitCode("SIGHUP")).toBe(129);
    expect(signalExitCode("SIGINT")).toBe(130);
    expect(signalExitCode("SIGTERM")).toBe(143);
  });
});
