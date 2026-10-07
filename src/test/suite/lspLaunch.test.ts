import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { LspLaunch, toLspArgs, toLspLaunch } from "../../core/lsp";
import {
  ProjectSnapshotInputs,
  ProjectSnapshotSettings,
} from "../../core/project";
import {
  baseInputs,
  snapshotFolder,
  snapshotWith,
} from "../arbitraries/projectSnapshot";
import { esmDirname } from "../esmDirname";

const repositoryRoot = path.resolve(esmDirname(import.meta.url), "../../..");
const folder = baseInputs.root;

const launchFor = (
  settings: Partial<ProjectSnapshotSettings>,
  rest: Partial<ProjectSnapshotInputs> = {},
): LspLaunch =>
  toLspLaunch(snapshotWith(settings, { environment: {}, ...rest }));

const run = {
  port: 4242,
  commandPrefix: "fusionPowerUser:abc:",
  projectDir: folder,
};

const launch = (overrides: Partial<LspLaunch> = {}): LspLaunch => ({
  executable: { source: "path" },
  projectDir: folder,
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
      folder,
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

describe("toLspLaunch", () => {
  it("resolves optional launch settings with defaults", () => {
    expect(launchFor({ lintEnabled: true })).toEqual({
      executable: { source: "path" },
      projectDir: folder,
      target: undefined,
      profilesDir: undefined,
      staticAnalysis: "project",
      lintEnabled: true,
      logLevel: undefined,
      environment: { DBT_LSP_USE_TARGET_LSP: "1" },
    });
  });

  it.each([
    [undefined, undefined, "separate"],
    ["shared", undefined, "shared"],
    ["separate", "shared", "shared"],
    ["shared", "separate", "separate"],
    ["shared", "bogus", "shared"],
    ["bogus", undefined, "separate"],
  ])(
    "resolves lsp.compiledOutput setting %s with override %s as %s",
    (setting, override, expected) => {
      const { environment } = launchFor(
        { lspCompiledOutput: setting },
        { lspCompiledOutputOverride: override },
      );
      expect(environment).toEqual(
        expected === "separate" ? { DBT_LSP_USE_TARGET_LSP: "1" } : {},
      );
    },
  );

  it("replaces an inherited DBT_LSP_USE_TARGET_LSP with the resolved mode", () => {
    const environment = { DBT_LSP_USE_TARGET_LSP: "0", KEEP: "yes" };
    expect(
      launchFor({ lspCompiledOutput: "shared" }, { environment }).environment,
    ).toEqual({ KEEP: "yes" });
    expect(launchFor({}, { environment }).environment).toEqual({
      KEEP: "yes",
      DBT_LSP_USE_TARGET_LSP: "1",
    });
  });

  it("resolves profilesDir with workspace and env substitution", () => {
    expect(
      launchFor(
        { profilesDir: "${env:FUSION_PROFILES}" },
        { environment: { FUSION_PROFILES: "profiles" } },
      ).profilesDir,
    ).toBe(path.resolve(snapshotFolder, "profiles"));
  });

  it.each([
    ["off", undefined],
    ["messages", "debug"],
    ["verbose", "trace"],
    [undefined, undefined],
  ] as const)("maps trace.server %s to log level %s", (level, expected) => {
    expect(launchFor({ traceServer: level }).logLevel).toBe(expected);
  });

  it("matches the package manifest for launch settings", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
    );
    const properties = manifest.contributes.configuration.flatMap(
      (section: { properties: Record<string, unknown> }) =>
        Object.keys(section.properties),
    );

    expect(properties).toEqual(
      expect.arrayContaining([
        "fusionPowerUser.profilesDir",
        "fusionPowerUser.target",
        "fusionPowerUser.lint.enabled",
        "fusionPowerUser.lsp.compiledOutput",
      ]),
    );
  });
});
