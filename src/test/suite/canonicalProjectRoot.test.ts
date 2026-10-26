import { describe, expect, it, type Mock } from "vitest";
import { Uri } from "vscode";
import { canonicalProjectRoot } from "../../fusion/canonicalProjectRoot";

describe("canonicalProjectRoot", () => {
  const fileUri = (fsPath: string) => Uri.file(fsPath);

  it("launches on the given root and installs no converters when it is already canonical", () => {
    expect(canonicalProjectRoot("/real/project", (p) => p)).toEqual({
      launchRoot: "/real/project",
    });
  });

  it("falls back to the given root when realpath fails", () => {
    const result = canonicalProjectRoot("/missing", () => {
      throw new Error("ENOENT");
    });
    expect(result).toEqual({ launchRoot: "/missing" });
  });

  it("maps document URIs between the symlinked root and its realpath", () => {
    const { launchRoot, uriConverters } = canonicalProjectRoot(
      "/link/project",
      () => "/real/project",
    );
    expect(launchRoot).toBe("/real/project");
    (Uri.parse as Mock).mockImplementation((value: unknown) =>
      Uri.file(String(value).replace(/^file:\/\//, "")),
    );

    expect(
      uriConverters!.code2Protocol(
        fileUri("/link/project/models/a.sql") as never,
      ),
    ).toBe("file:///real/project/models/a.sql");
    expect(
      uriConverters!.code2Protocol(
        fileUri("/link/project-other/a.sql") as never,
      ),
    ).toBe("file:///link/project-other/a.sql");
    expect(
      uriConverters!.protocol2Code("file:///real/project/models/a.sql").fsPath,
    ).toBe("/link/project/models/a.sql");
    expect(uriConverters!.protocol2Code("file:///elsewhere/a.sql").fsPath).toBe(
      "/elsewhere/a.sql",
    );
  });
});
