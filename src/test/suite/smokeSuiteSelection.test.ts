import { describe, expect, it } from "vitest";
import { selectSuites } from "../smoke/suiteSelection";

const all = [
  "panelSmoke",
  "lspSmoke",
  "lineageInteractions",
  "toolEnvironment",
  "hostWarmUp",
];

describe("selectSuites", () => {
  it("returns the sorted default set when unset or empty", () => {
    expect(selectSuites(all, undefined)).toEqual(["lspSmoke", "panelSmoke"]);
    expect(selectSuites(all, "")).toEqual(["lspSmoke", "panelSmoke"]);
  });

  it("leaves the warm-up out of the default set and selects only it when named", () => {
    expect(selectSuites(all, undefined)).not.toContain("hostWarmUp");
    expect(selectSuites(all, "hostWarmUp")).toEqual(["hostWarmUp"]);
  });

  it("treats default alone as the unset set and adds a named opt-in", () => {
    expect(selectSuites(all, "default")).toEqual(selectSuites(all, undefined));
    expect(selectSuites(all, "default,lineageInteractions")).toEqual([
      "lineageInteractions",
      "lspSmoke",
      "panelSmoke",
    ]);
  });

  it("expands default and adds opt-in suites without duplicates", () => {
    expect(selectSuites(all, "default, toolEnvironment,default")).toEqual([
      "lspSmoke",
      "panelSmoke",
      "toolEnvironment",
    ]);
  });

  it("throws naming an unknown or missing suite", () => {
    expect(() => selectSuites(all, "default,nope")).toThrow("nope");
    expect(() => selectSuites(all, "queryResultsInteractions")).toThrow(
      "queryResultsInteractions",
    );
  });
});
