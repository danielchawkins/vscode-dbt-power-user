import { describe, expect, it } from "vitest";
import {
  LABELS,
  labelsToPrepare,
  VSIX_LABELS,
} from "../../../scripts/test/integration-layout.mjs";

describe("labelsToPrepare", () => {
  it("prepares every label when none is selected", () => {
    expect(labelsToPrepare([])).toEqual([...LABELS, ...VSIX_LABELS]);
  });

  it("prepares only the selected CLI label", () => {
    expect(labelsToPrepare(["symlinked"])).toEqual(["symlinked"]);
  });

  it("resolves a numeric selection to the label at that position", () => {
    expect(labelsToPrepare(["2"])).toEqual([LABELS[2]]);
    expect(labelsToPrepare(["2", "trusted"])).toEqual(["trusted", LABELS[2]]);
  });

  it("prepares nothing for a selection that names no label", () => {
    expect(labelsToPrepare(["nope"])).toEqual([]);
    expect(labelsToPrepare([String(LABELS.length)])).toEqual([]);
  });

  it("prepares selected CLI and VSIX labels in run order", () => {
    expect(labelsToPrepare(["untrusted", "native-strict", "trusted"])).toEqual([
      "trusted",
      "native-strict",
      "untrusted",
    ]);
  });
});
