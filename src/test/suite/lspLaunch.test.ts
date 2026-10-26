import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LspLaunch } from "../../core/lsp";
import {
  lspProcessEnv,
  sameLspLaunch,
  toLspArgs,
  toLspLaunch,
} from "../../core/lsp";
import type {
  ProjectSnapshotInputs,
  ProjectSnapshotSettings,
} from "../../core/snapshot";
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
  profile: undefined,
  profilesDir: undefined,
  staticAnalysis: "project",
  lintEnabled: true,
  maxErrorReporting: undefined,
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
      "--log-level-file",
      "trace",
    ]);
  });

  it("passes --profile only when the launch sets one", () => {
    expect(toLspArgs(launch(), run)).not.toContain("--profile");
    expect(toLspArgs(launch({ profile: "" }), run)).not.toContain("--profile");

    const args = toLspArgs(launch({ profile: "analytics" }), run);
    expect(args[args.indexOf("--profile") + 1]).toBe("analytics");
  });
});

describe("lspProcessEnv", () => {
  it("layers the caller's environment over the launch's, except DBT_LSP_USE_TARGET_LSP", () => {
    expect(
      lspProcessEnv(
        { PATH: "/opt/bin", ORIGIN: "a", DBT_LSP_USE_TARGET_LSP: "1" },
        { ORIGIN: "b", DBT_LSP_USE_TARGET_LSP: "0" },
      ),
    ).toEqual({ PATH: "/opt/bin", ORIGIN: "b", DBT_LSP_USE_TARGET_LSP: "1" });
  });

  it("is the launch's environment alone when the caller has none", () => {
    expect(lspProcessEnv({ PATH: "/opt/bin" }, undefined)).toEqual({
      PATH: "/opt/bin",
    });
  });
});

describe("toLspLaunch", () => {
  it("resolves optional launch settings with defaults", () => {
    expect(launchFor({ lintEnabled: true })).toEqual({
      executable: { source: "path" },
      projectDir: folder,
      target: undefined,
      profile: undefined,
      profilesDir: undefined,
      staticAnalysis: "project",
      lintEnabled: true,
      logLevel: undefined,
      environment: { DBT_LSP_USE_TARGET_LSP: "1" },
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
        "fusionPowerUser.profile",
        "fusionPowerUser.lint.enabled",
        "fusionPowerUser.lsp.compiledOutput",
      ]),
    );
  });
});

describe("sameLspLaunch", () => {
  it.each([
    [{ source: "path" } as const],
    [{ source: "configured", path: "/opt/dbt" } as const],
  ])(
    "restarts when only the resolved path differs for source %o",
    (executable) => {
      const a = launch({ executable, resolvedPath: "/mise/1/bin/dbt" });
      const b = launch({ executable, resolvedPath: "/mise/2/bin/dbt" });
      expect(sameLspLaunch(a, b)).toBe(false);
      expect(sameLspLaunch(a, { ...a })).toBe(true);
    },
  );

  it("treats a path source and a configured source at the same resolved path as different", () => {
    const resolvedPath = "/opt/dbt";
    const a = launch({ executable: { source: "path" }, resolvedPath });
    const b = launch({
      executable: { source: "configured", path: resolvedPath },
      resolvedPath,
    });
    expect(sameLspLaunch(a, b)).toBe(false);
  });
});
