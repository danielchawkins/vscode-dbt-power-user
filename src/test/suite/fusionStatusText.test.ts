import { describe, expect, it } from "vitest";
import { LanguageStatusSeverity } from "vscode";
import {
  clientItemView,
  staticText,
} from "../../projects/clients/fusionStatusText";

describe("fusionStatusText", () => {
  it("shows the configured static-analysis mode, or the mode the project file selects under project", () => {
    expect(staticText("strict", false)).toBe("static: strict");
    expect(staticText("project", true)).toBe("static: strict (project)");
    expect(staticText("project", false)).toBe("static: baseline (project)");
  });

  it("shows a running client with the project name, no spinner and the output command", () => {
    expect(
      clientItemView({
        projectName: "general",
        state: "running",
        failureReason: undefined,
        notes: {},
      }),
    ).toEqual({
      text: "$(check) dbt Fusion",
      severity: LanguageStatusSeverity.Information,
      busy: false,
      detail: "general",
      command: {
        title: "Show output",
        command: "fusionPowerUser.showFusionOutput",
      },
    });
  });

  it("shows a failure's first line as the detail, with the error severity", () => {
    const view = clientItemView({
      projectName: "general",
      state: "failed",
      failureReason: "boom\nmore detail",
      notes: {},
    });
    expect(view.text).toBe("$(error) dbt Fusion");
    expect(view.severity).toBe(LanguageStatusSeverity.Error);
    expect(view.detail).toBe("general: boom");
  });

  it("marks starting and restarting clients busy", () => {
    for (const state of ["starting", "restarting"] as const) {
      const view = clientItemView({
        projectName: "general",
        state,
        failureReason: undefined,
        notes: {},
      });
      expect(view.busy).toBe(true);
      expect(view.severity).toBe(LanguageStatusSeverity.Information);
    }
  });

  it("shows a configuration error with the error severity and the environment note after it", () => {
    const view = clientItemView({
      projectName: "general",
      state: "stopped",
      failureReason: undefined,
      notes: { error: "bad yaml", environment: "dbt 2.0.6" },
    });
    expect(view.text).toBe("$(error) dbt Fusion");
    expect(view.severity).toBe(LanguageStatusSeverity.Error);
    expect(view.detail).toBe("general: bad yaml · dbt 2.0.6");
  });

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
