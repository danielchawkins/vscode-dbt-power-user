import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";
import {
  ConfigurationChangeEvent,
  Uri,
  workspace,
  WorkspaceConfiguration,
} from "vscode";
import {
  CONFIGURATION_SECTION,
  onDidChangeSettings,
  readSetting,
  SETTING_SCOPES,
  SettingsChange,
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
