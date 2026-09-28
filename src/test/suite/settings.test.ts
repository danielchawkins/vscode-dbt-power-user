import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";
import {
  ConfigurationChangeEvent,
  ConfigurationTarget,
  Uri,
  workspace,
  WorkspaceConfiguration,
} from "vscode";
import {
  CONFIGURATION_SECTION,
  inspectSettings,
  onDidChangeSettings,
  readFileAssociations,
  readFolderFileAssociations,
  readSetting,
  SETTING_SCOPES,
  SettingsChange,
  writeFolderFileAssociations,
  writeSetting,
} from "../../settings";
import { esmDirname } from "../esmDirname";

const repositoryRoot = path.resolve(esmDirname(import.meta.url), "../../..");

function contributedScopes(): Record<string, string> {
  const manifest = JSON.parse(
    readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
  ) as {
    contributes: {
      configuration: Array<{
        properties: Record<string, { scope?: string }>;
      }>;
    };
  };
  const prefix = `${CONFIGURATION_SECTION}.`;
  return Object.fromEntries(
    manifest.contributes.configuration
      .flatMap((section) => Object.entries(section.properties))
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, property]) => [
        key.slice(prefix.length),
        property.scope ?? "window",
      ]),
  );
}

describe("settings", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("declares exactly the contributed settings with their scopes", () => {
    expect(SETTING_SCOPES).toEqual(contributedScopes());
  });

  it("reads resource-scoped keys for a resource and window keys unscoped", () => {
    const scope = Uri.file("/workspace/general");
    const get = jest.fn<(key: string) => unknown>();
    const getConfiguration = jest
      .spyOn(workspace, "getConfiguration")
      .mockReturnValue({ get } as unknown as WorkspaceConfiguration);

    get.mockReturnValueOnce("strict");
    expect(readSetting("staticAnalysis", scope)).toBe("strict");
    expect(getConfiguration).toHaveBeenCalledWith(CONFIGURATION_SECTION, scope);

    get.mockReturnValueOnce(250);
    expect(readSetting("query.limit")).toBe(250);
    expect(getConfiguration).toHaveBeenLastCalledWith(
      CONFIGURATION_SECTION,
      undefined,
    );
  });

  it("writes a window-scoped key, letting VS Code pick the target", async () => {
    const update = jest.fn((..._args: unknown[]) => Promise.resolve());
    const getConfiguration = jest
      .spyOn(workspace, "getConfiguration")
      .mockReturnValue({ update } as unknown as WorkspaceConfiguration);

    await writeSetting("query.limit", 100);
    await writeSetting("queryResults.theme", undefined);

    expect(getConfiguration).toHaveBeenCalledWith(CONFIGURATION_SECTION);
    expect(update).toHaveBeenNthCalledWith(1, "query.limit", 100);
    expect(update).toHaveBeenNthCalledWith(2, "queryResults.theme", undefined);
  });

  it("inspects each key of the user, default and workspace layers", () => {
    const effective: Record<string, unknown> = {
      "query.limit": 100,
      enabled: true,
      staticAnalysis: "strict",
      "lint.enabled": false,
      projects: ["a", "b"],
    };
    jest.spyOn(workspace, "getConfiguration").mockImplementation(
      (section?: string) =>
        ({
          inspect: (key: string) => {
            expect(section).toBeUndefined();
            expect(key).toBe(CONFIGURATION_SECTION);
            return {
              key,
              globalValue: { "query.limit": 100, staticAnalysis: "strict" },
              defaultValue: { "query.limit": 500, enabled: true },
              workspaceValue: {
                staticAnalysis: "strict",
                "lint.enabled": false,
                projects: ["a", "b"],
              },
            };
          },
          get: (key: string) => effective[key],
        }) as unknown as WorkspaceConfiguration,
    );

    expect(inspectSettings()).toEqual([
      { key: "query.limit", value: 100, overriddenIn: "user" },
      { key: "staticAnalysis", value: "strict", overriddenIn: "workspace" },
      { key: "query.limit", value: 100, overriddenIn: "user" },
      { key: "enabled", value: true },
      { key: "staticAnalysis", value: "strict", overriddenIn: "workspace" },
      { key: "lint.enabled", value: false, overriddenIn: "workspace" },
      { key: "projects", value: ["a", "b"], overriddenIn: "workspace" },
    ]);
  });

  it("reads and writes files.associations for a folder", async () => {
    const folder = Uri.file("/workspace/general");
    const update = jest.fn((..._args: unknown[]) => Promise.resolve());
    const getConfiguration = jest
      .spyOn(workspace, "getConfiguration")
      .mockReturnValue({
        get: (_key: string, fallback: unknown) => fallback,
        inspect: () => ({
          key: "associations",
          workspaceFolderValue: { "*.sql": "jinja-sql" },
        }),
        update,
      } as unknown as WorkspaceConfiguration);

    expect(readFileAssociations(folder)).toEqual({});
    expect(readFolderFileAssociations(folder)).toEqual({
      "*.sql": "jinja-sql",
    });
    await writeFolderFileAssociations(folder, { "a/*.sql": "jinja-sql" });

    expect(getConfiguration).toHaveBeenCalledWith("files", folder);
    expect(update).toHaveBeenCalledWith(
      "associations",
      { "a/*.sql": "jinja-sql" },
      ConfigurationTarget.WorkspaceFolder,
    );
  });

  it("reports whether a subscribed key changed for a resource", () => {
    const scope = Uri.file("/workspace/general");
    let fire: ((event: ConfigurationChangeEvent) => void) | undefined;
    jest
      .spyOn(workspace, "onDidChangeConfiguration")
      .mockImplementation((listener) => {
        fire = listener as typeof fire;
        return { dispose: jest.fn() };
      });
    const changes: SettingsChange[] = [];
    onDidChangeSettings(["target", "dbtPath"], (change) =>
      changes.push(change),
    );

    fire?.({
      affectsConfiguration: (section: string, resource?: Uri) =>
        section === `${CONFIGURATION_SECTION}.dbtPath` &&
        (resource === undefined || resource.fsPath === scope.fsPath),
    } as ConfigurationChangeEvent);

    expect(changes).toHaveLength(1);
    expect(changes[0].affects()).toBe(true);
    expect(changes[0].affects(scope)).toBe(true);
    expect(changes[0].affects(Uri.file("/workspace/other"))).toBe(false);
  });
});
