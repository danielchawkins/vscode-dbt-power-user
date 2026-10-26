import { describe, expect, it } from "vitest";
import { LanguageStatusSeverity } from "vscode";
import { clientItemView } from "../../projects/clients/fusionStatusText";

describe("fusionStatusText", () => {
  it("shows a failure's summary in place of a configuration error", () => {
    const view = clientItemView({
      projectName: "general",
      state: "failed",
      failureReason: "listen failed",
      notes: { error: "bad yaml" },
    });
    expect(view.text).toBe("$(error) dbt Fusion");
    expect(view.detail).toBe("general: listen failed");
  });

  it("ignores a stale failure reason once the client is no longer failed", () => {
    const view = clientItemView({
      projectName: "general",
      state: "running",
      failureReason: "listen failed",
      notes: {},
    });
    expect(view.severity).toBe(LanguageStatusSeverity.Information);
    expect(view.detail).toBe("general");
  });
});
