import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";
import {
  ConfigurationChangeEvent,
  Uri,
  workspace,
  WorkspaceFolder,
} from "vscode";
import {
  affectsFusionLaunchConfiguration,
  LINT_ENABLED_SETTING,
  PROFILES_DIR_SETTING,
  resolveFusionLaunchSettings,
  TARGET_SETTING,
} from "../../lsp/fusionClientSettings";
import { CONFIGURATION_SECTION } from "../../projects/projectConfiguration";
import { esmDirname } from "../esmDirname";

const repositoryRoot = path.resolve(esmDirname(import.meta.url), "../../..");
const scope = Uri.file("/workspace/general/models/stg.sql");
const folder: WorkspaceFolder = {
  uri: Uri.file("/workspace/general"),
  name: "general",
  index: 0,
};

describe("fusionClientSettings", () => {
  afterEach(() => {
    jest.mocked(workspace.getConfiguration).mockRestore();
  });

  it("resolves optional launch settings with defaults", () => {
    jest.spyOn(workspace, "getConfiguration").mockReturnValue({
      get: jest.fn((key: string) => {
        if (key === LINT_ENABLED_SETTING) {
          return undefined;
        }
        return undefined;
      }),
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
    });
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

  it("matches launch-affecting configuration keys per scope", () => {
    const event = {
      affectsConfiguration: jest.fn((key: string, uri?: Uri) => {
        return (
          key === `${CONFIGURATION_SECTION}.${TARGET_SETTING}` &&
          uri?.fsPath === scope.fsPath
        );
      }),
    } as unknown as ConfigurationChangeEvent;

    expect(affectsFusionLaunchConfiguration(event, scope)).toBe(true);
    expect(
      affectsFusionLaunchConfiguration(
        {
          affectsConfiguration: () => false,
        } as unknown as ConfigurationChangeEvent,
        scope,
      ),
    ).toBe(false);
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
        "dbt.profilesDir",
        "dbt.target",
        "dbt.lintEnabled",
      ]),
    );
  });
});
