import { describe, expect, it } from "@jest/globals";
import { LspLaunch, toLspArgs } from "../../core/lsp";

const run = {
  port: 4242,
  commandPrefix: "fusionPowerUser:abc:",
  projectDir: "/workspace/general",
};

const launch = (overrides: Partial<LspLaunch> = {}): LspLaunch => ({
  executable: { source: "path" },
  projectDir: "/workspace/general",
  target: undefined,
  profilesDir: undefined,
  staticAnalysis: "project",
  lintEnabled: true,
  logLevel: undefined,
  environment: {},
  ...overrides,
});

describe("toLspArgs", () => {
  it("builds args in the required order with optional launch flags", () => {
    const args = toLspArgs(
      launch({
        lintEnabled: false,
        staticAnalysis: "strict",
        logLevel: "trace",
        profilesDir: "/profiles",
        target: "dev",
      }),
      run,
    );

    expect(args).toEqual([
      "lsp",
      "--socket",
      "4242",
      "--project-dir",
      "/workspace/general",
      "--lint-enabled",
      "false",
      "--static-analysis",
      "strict",
      "--no-version-check",
      "--command-prefix",
      "fusionPowerUser:abc:",
      "--profiles-dir",
      "/profiles",
      "--target",
      "dev",
      "--log-level",
      "trace",
    ]);
  });

  it("omits the log level when there is none", () => {
    const args = toLspArgs(launch({ staticAnalysis: "baseline" }), run);
    expect(args).not.toContain("--log-level");
  });

  it("uses the run's project dir, not the launch's", () => {
    const args = toLspArgs(launch({ projectDir: "/link" }), {
      ...run,
      projectDir: "/real",
    });
    expect(args[args.indexOf("--project-dir") + 1]).toBe("/real");
  });

  it("passes no --static-analysis for project mode", () => {
    expect(toLspArgs(launch(), run)).not.toContain("--static-analysis");
  });

  it.each(["off", "baseline", "strict"] as const)(
    "passes exactly one --static-analysis %s",
    (mode) => {
      const args = toLspArgs(launch({ staticAnalysis: mode }), run);
      expect(args.filter((arg) => arg === "--static-analysis")).toHaveLength(1);
      expect(args[args.indexOf("--static-analysis") + 1]).toBe(mode);
    },
  );
});
