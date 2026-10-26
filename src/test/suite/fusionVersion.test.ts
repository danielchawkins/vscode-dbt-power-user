import { describe, expect, it } from "vitest";
import {
  judgeFusionVersion,
  parseFusionVersion,
} from "../../fusion/fusionVersion";

describe("Fusion version", () => {
  it("accepts the minimum supported Fusion version", () => {
    const raw = "dbt 2.0.6\n";

    expect(judgeFusionVersion(parseFusionVersion(raw), raw)).toEqual({
      kind: "ok",
      version: { major: 2, minor: 0, patch: 6, raw },
    });
  });

  it.each(["dbt 2.1.0\n"])("accepts later 2.x version %j", (raw) => {
    expect(judgeFusionVersion(parseFusionVersion(raw), raw).kind).toBe("ok");
  });

  it.each([["dbt 2.0.5\n", 5]])(
    "rejects %j below the minimum",
    (raw, patch) => {
      expect(judgeFusionVersion(parseFusionVersion(raw), raw)).toEqual({
        kind: "tooOld",
        version: { major: 2, minor: 0, patch, raw },
      });
    },
  );

  it.each([
    ["dbt 2.0.6-preview.3 (a1b2c3d 2026-09-01)\n", "ok"],
    ["dbt 2.0.8+build.7\n", "ok"],
    ["dbt-fusion 2.0.7\n", "ok"],
    ["dbt 2.0.5-preview.1 (abc)\n", "tooOld"],
    ["dbt-fusion 2.0.0-beta.40\n", "tooOld"],
  ])("reads a prerelease, build or legacy banner %j", (raw, kind) => {
    expect(judgeFusionVersion(parseFusionVersion(raw), raw).kind).toBe(kind);
  });

  it("allows an untested major version", () => {
    const raw = "dbt 3.0.0\n";

    expect(judgeFusionVersion(parseFusionVersion(raw), raw)).toEqual({
      kind: "untestedMajor",
      version: { major: 3, minor: 0, patch: 0, raw },
    });
  });

  it("rejects dbt Core version output", () => {
    const raw = `Core:
  - installed: 1.8.8
  - latest:    1.8.8 - Up to date!

Plugins:
  - postgres: 1.8.2 - Up to date!
`;

    expect(judgeFusionVersion(parseFusionVersion(raw), raw)).toEqual({
      kind: "notFusion",
      raw,
    });
  });

  it("rejects empty version output", () => {
    expect(judgeFusionVersion(parseFusionVersion(""), "")).toEqual({
      kind: "notFusion",
      raw: "",
    });
  });
});
