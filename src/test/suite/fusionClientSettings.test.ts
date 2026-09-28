import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";
import { Uri, workspace, WorkspaceFolder } from "vscode";
import { DBT_PATH_SETTING } from "../../fusion/fusionExecutable";
import { STATIC_ANALYSIS_MODE_SETTING } from "../../fusion/staticAnalysisMode";
import {
  FUSION_LAUNCH_SETTINGS,
  LINT_ENABLED_SETTING,
  LSP_COMPILED_OUTPUT_SETTING,
  lspCompiledOutputEnv,
  PROFILES_DIR_SETTING,
  resolveFusionLaunchSettings,
  TARGET_SETTING,
  TRACE_SERVER_SETTING,
} from "../../lsp/fusionClientSettings";
import { esmDirname } from "../esmDirname";

const repositoryRoot = path.resolve(esmDirname(import.meta.url), "../../..");
const scope = Uri.file("/workspace/general/models/stg.sql");
const folder: WorkspaceFolder = {
  uri: Uri.file("/workspace/general"),
  name: "general",
  index: 0,
};

describe("fusionClientSettings", () => {
  const originalCompiledOutput =
    process.env.FUSION_POWER_USER_LSP_COMPILED_OUTPUT;

  beforeEach(() => {
    delete process.env.FUSION_POWER_USER_LSP_COMPILED_OUTPUT;
  });

  afterEach(() => {
    jest.mocked(workspace.getConfiguration).mockRestore();
    if (originalCompiledOutput === undefined) {
      delete process.env.FUSION_POWER_USER_LSP_COMPILED_OUTPUT;
    } else {
      process.env.FUSION_POWER_USER_LSP_COMPILED_OUTPUT =
        originalCompiledOutput;
    }
  });

  it("resolves optional launch settings with defaults", () => {
    jest.spyOn(workspace, "getConfiguration").mockReturnValue({
      get: jest.fn((key: string) =>
        key === LINT_ENABLED_SETTING ? true : undefined,
      ),
    } as any);

    expect(
      resolveFusionLaunchSettings(scope, {
        getWorkspaceFolder: () => folder,
        getUserHome: () => "/home/test",
      }),
    ).toEqual({
      profilesDir: undefined,
      target: undefined,
      lintEnabled: true,
      traceServer: "off",
      lspCompiledOutput: "separate",
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
    "resolves lsp.compiledOutput setting %s with env %s as %s",
    (setting, env, expected) => {
      jest.spyOn(workspace, "getConfiguration").mockReturnValue({
        get: jest.fn((key: string) =>
          key === LSP_COMPILED_OUTPUT_SETTING ? setting : undefined,
        ),
      } as any);

      if (env !== undefined) {
        process.env.FUSION_POWER_USER_LSP_COMPILED_OUTPUT = env;
      }

      expect(
        resolveFusionLaunchSettings(scope, {
          getWorkspaceFolder: () => folder,
          getUserHome: () => "/home/test",
        }).lspCompiledOutput,
      ).toBe(expected);
    },
  );

  it("maps compiled output to the server environment", () => {
    expect(lspCompiledOutputEnv("separate")).toEqual({
      DBT_LSP_USE_TARGET_LSP: "1",
    });
    expect(lspCompiledOutputEnv("shared")).toEqual({});
  });

  it("resolves profilesDir with workspace and env substitution", () => {
    process.env.FUSION_PROFILES = "profiles";
    jest.spyOn(workspace, "getConfiguration").mockReturnValue({
      get: jest.fn((key: string) => {
        if (key === PROFILES_DIR_SETTING) {
          return "${env:FUSION_PROFILES}";
        }
        return undefined;
      }),
    } as any);

    expect(
      resolveFusionLaunchSettings(scope, {
        getWorkspaceFolder: () => folder,
        getUserHome: () => "/home/test",
      }).profilesDir,
    ).toBe(path.resolve("/workspace/general", "profiles"));
    delete process.env.FUSION_PROFILES;
  });

  it("treats every launch input as launch-affecting", () => {
    expect([...FUSION_LAUNCH_SETTINGS].sort()).toEqual(
      [
        DBT_PATH_SETTING,
        STATIC_ANALYSIS_MODE_SETTING,
        PROFILES_DIR_SETTING,
        TARGET_SETTING,
        LINT_ENABLED_SETTING,
        TRACE_SERVER_SETTING,
        LSP_COMPILED_OUTPUT_SETTING,
      ].sort(),
    );
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
