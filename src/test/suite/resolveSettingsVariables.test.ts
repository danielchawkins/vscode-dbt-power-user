import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { workspace, type Uri } from "vscode";
import { resolveSettingsVariables } from "../../utils";

// The vscode mock's `Uri` re-imports from "vscode" recursively, so construct
// a minimal shape instead. `resolveSettingsVariables` only reads `.fsPath`.
const mockUri = (fsPath: string): Uri => ({ fsPath }) as unknown as Uri;

describe("resolveSettingsVariables", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("resolves a single ${env:VAR} placeholder", () => {
    process.env.FOO = "hello";
    expect(resolveSettingsVariables("--vars=${env:FOO}")).toBe("--vars=hello");
  });

  it("resolves MULTIPLE ${env:VAR} placeholders in one string", () => {
    // Regression: the previous implementation used a stateful global regex
    // with a mutating string, so the second placeholder was skipped.
    process.env.FOO = "alpha";
    process.env.BAR = "beta";
    expect(resolveSettingsVariables("--vars='a=${env:FOO},b=${env:BAR}'")).toBe(
      "--vars='a=alpha,b=beta'",
    );
  });

  it("resolves repeated occurrences of the same ${env:VAR}", () => {
    process.env.FOO = "x";
    expect(resolveSettingsVariables("${env:FOO}/${env:FOO}")).toBe("x/x");
  });

  it("leaves unresolved ${env:VAR} placeholders untouched", () => {
    delete process.env.NOT_SET;
    expect(resolveSettingsVariables("before ${env:NOT_SET} after")).toBe(
      "before ${env:NOT_SET} after",
    );
  });

  it("treats env values containing $ characters as literal", () => {
    // Regression: passing a raw value to String.replace() causes patterns
    // like `$1`, `$&`, `$$` to be interpreted as backreferences, silently
    // corrupting paths like `/home/$USER/project`.
    process.env.WEIRD = "/home/$USER/$1/$&";
    expect(resolveSettingsVariables("path=${env:WEIRD}")).toBe(
      "path=/home/$USER/$1/$&",
    );
  });

  it("resolves ${workspaceFolder} using the provided Uri", () => {
    const folder = mockUri("/workspace/project");
    expect(resolveSettingsVariables("${workspaceFolder}/models", folder)).toBe(
      "/workspace/project/models",
    );
  });

  it("treats workspace folder paths containing $ characters as literal", () => {
    // Windows paths can legitimately contain `$` (e.g. hidden admin shares).
    const folder = mockUri("/weird/$1/path");
    expect(resolveSettingsVariables("${workspaceFolder}/models", folder)).toBe(
      "/weird/$1/path/models",
    );
  });

  it("handles mixed ${env:VAR} and ${workspaceFolder} substitutions", () => {
    process.env.PROFILE = "dev";
    const folder = mockUri("/ws");
    expect(
      resolveSettingsVariables(
        "--profile ${env:PROFILE} --project-dir ${workspaceFolder}",
        folder,
      ),
    ).toBe("--profile dev --project-dir /ws");
  });

  it("resolves ${userHome} using the provided home directory", () => {
    expect(
      resolveSettingsVariables(
        "${userHome}/.local/bin/dbt",
        undefined,
        "/mock/home",
      ),
    ).toBe("/mock/home/.local/bin/dbt");
  });

  it("treats userHome paths containing $ characters as literal", () => {
    expect(
      resolveSettingsVariables(
        "${userHome}/tools",
        undefined,
        "/weird/$1/home",
      ),
    ).toBe("/weird/$1/home/tools");
  });

  it("returns empty string unchanged", () => {
    expect(resolveSettingsVariables("")).toBe("");
  });

  it("does not fall back to the first workspace folder when null is passed", () => {
    const folder = mockUri("/first/workspace");
    (workspace.workspaceFolders as unknown as Array<{ uri: Uri }>) = [
      { uri: folder },
    ];

    expect(
      resolveSettingsVariables("${workspaceFolder}/models", null, "/mock/home"),
    ).toBe("${workspaceFolder}/models");
  });
});
