import { describe, expect, it } from "@jest/globals";
import {
  judgeFusionVersion,
  parseFusionVersion,
} from "../../fusion/fusionVersion";

describe("Fusion version", () => {
  it("accepts the minimum supported Fusion version", () => {
    const raw = "dbt 2.0.5\n";

    expect(judgeFusionVersion(parseFusionVersion(raw), raw)).toEqual({
      kind: "ok",
      version: { major: 2, minor: 0, patch: 5, raw },
    });
  });

  it("allows an untested major version", () => {
    const raw = "dbt 3.0.0\n";

    expect(judgeFusionVersion(parseFusionVersion(raw), raw)).toEqual({
      kind: "untestedMajor",
      version: { major: 3, minor: 0, patch: 0, raw },
    });
  });

  it("rejects a Fusion version below the minimum", () => {
    const raw = "dbt 2.0.4\n";

    expect(judgeFusionVersion(parseFusionVersion(raw), raw)).toEqual({
      kind: "tooOld",
      version: { major: 2, minor: 0, patch: 4, raw },
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
