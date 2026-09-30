import { describe, expect, it, vi } from "vitest";
import {
  DiagnosticCollection,
  DiagnosticSeverity,
  languages,
  Uri,
} from "vscode";
import { DBTDiagnosticData } from "../../dbt_integration";
import { ProjectDiagnostics } from "../../projects/projectDiagnostics";

const data = (
  message: string,
  severity: DBTDiagnosticData["severity"],
): DBTDiagnosticData => ({
  filePath: "/p/dbt_project.yml",
  message,
  severity,
  source: "test",
  category: "test",
});

describe("ProjectDiagnostics", () => {
  const file = Uri.file("/p/dbt_project.yml");

  it("merges every kind onto the one file", () => {
    const diagnostics = new ProjectDiagnostics(file);
    diagnostics.setKind("rebuild-manifest", [data("parse", "warning")]);
    diagnostics.setKind("project-config", [data("config", "error")]);

    const { results } = vi.mocked(languages.createDiagnosticCollection).mock;
    const collection = results[results.length - 1]
      ?.value as DiagnosticCollection;
    expect(collection.set).toHaveBeenLastCalledWith(file, [
      expect.objectContaining({ message: "parse" }),
      expect.objectContaining({ message: "config" }),
    ]);
    expect(diagnostics.all().map((d) => d.message)).toEqual([
      "parse",
      "config",
    ]);

    diagnostics.setKind("rebuild-manifest", []);
    expect(diagnostics.all().map((d) => d.message)).toEqual(["config"]);
  });

  it("sets source and code to the kind", () => {
    const diagnostics = new ProjectDiagnostics(file);
    diagnostics.setKind("fusion-executable", [data("missing", "info")]);

    expect(diagnostics.all()).toEqual([
      expect.objectContaining({
        source: "Fusion Power User",
        code: "fusion-executable",
        severity: DiagnosticSeverity.Information,
      }),
    ]);
  });

  it("returns the first error-severity diagnostic", () => {
    const diagnostics = new ProjectDiagnostics(file);
    expect(diagnostics.firstError()).toBeUndefined();

    diagnostics.setKind("project-config", [
      data("warn", "warning"),
      data("broken", "error"),
      data("also broken", "error"),
    ]);

    expect(diagnostics.firstError()?.message).toBe("broken");
  });

  it("splits config data by source and clears executable data alone", () => {
    const diagnostics = new ProjectDiagnostics(file);
    const executable = { ...data("missing dbt", "error") };
    executable.source = "fusion-executable";
    diagnostics.addConfig(data("config", "warning"));
    diagnostics.addConfig(executable);
    const codes = () => diagnostics.all().map((d) => [d.message, d.code]);

    expect(codes()).toEqual([
      ["config", "project-config"],
      ["missing dbt", "fusion-executable"],
    ]);

    diagnostics.replaceExecutable(undefined);
    expect(codes()).toEqual([["config", "project-config"]]);

    diagnostics.replaceExecutable(executable);
    expect(codes()).toEqual([
      ["config", "project-config"],
      ["missing dbt", "fusion-executable"],
    ]);
    diagnostics.clearConfig();
    expect(codes()).toEqual([]);
  });
});
