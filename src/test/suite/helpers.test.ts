import { afterEach, describe, expect, it, vi } from "vitest";
import { Uri, window, workspace } from "vscode";
import {
  getColumnTestConfigFromYml,
  isAcceptedValues,
  isRelationship,
  type YamlTest,
} from "../../core/manifest/testConfig";
import {
  extractDbtSubcommand,
  getFormattedDateTime,
  getStringSizeInMb,
  removeProtocol,
  stripANSI,
} from "../../core/text";
import {
  getCurrentlySelectedModelNameInYamlConfig,
  getDepthColor,
} from "../../features/modelTree/modelTreeHelpers";
import {
  getColumnNameByCase,
  isColumnNameEqual,
  isQuotedIdentifier,
} from "../../projects/columnNames";
import { getFirstWorkspacePath } from "../../projects/workspacePath";

describe("text, column name, test config and workspace helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getStringSizeInMb handles multibyte characters", () => {
    const asciiSize = getStringSizeInMb("abc");
    const multiSize = getStringSizeInMb("πππ");
    expect(asciiSize).toBeCloseTo(3 / (1024 * 1024));
    expect(multiSize).toBeCloseTo(6 / (1024 * 1024));
  });

  it("isQuotedIdentifier respects custom regex", () => {
    vi.spyOn(workspace, "getConfiguration").mockReturnValue({
      get: (key: string) =>
        key === "unquotedCaseInsensitiveIdentifierRegex"
          ? "^[a-z]+$"
          : undefined,
    } as any);
    expect(isQuotedIdentifier("abc", "any")).toBe(false);
    expect(isQuotedIdentifier("ABC", "any")).toBe(true);
  });

  it("getColumnNameByCase and isColumnNameEqual lowercase unquoted names", () => {
    vi.spyOn(workspace, "getConfiguration").mockReturnValue({
      get: () => "",
    } as any);
    expect(getColumnNameByCase("TEST", "snowflake")).toBe("test");
    expect(isColumnNameEqual("CoL", "col")).toBe(true);
  });

  it("getFirstWorkspacePath falls back when no workspace", () => {
    (workspace.workspaceFolders as any) = undefined;
    vi.spyOn(Uri, "file").mockReturnValue({ fsPath: "./" } as any);
    expect(getFirstWorkspacePath()).toBe("./");
  });

  it("getCurrentlySelectedModelNameInYamlConfig returns model", () => {
    const yaml = `models:\n  - name: model_a\n  - name: model_b`;
    const lines = yaml.split("\n");
    const document = {
      languageId: "yaml",
      getText: () => yaml,
      offsetAt: ({ line, character }: any) =>
        lines.slice(0, line).join("\n").length + (line > 0 ? 1 : 0) + character,
    } as any;
    (window as any).activeTextEditor = {
      document,
      selection: { active: { line: 2, character: 5 } },
    };
    expect(getCurrentlySelectedModelNameInYamlConfig()).toBe("model_b");
  });

  it("type guard helpers identify metadata", () => {
    const rel = { field: "id", to: "ref" };
    const acc = { values: ["a", "b"] };
    expect(isRelationship(rel)).toBe(true);
    expect(isAcceptedValues(rel)).toBe(false);
    expect(isAcceptedValues(acc)).toBe(true);
    expect(isRelationship(acc)).toBe(false);
  });

  it("getColumnTestConfigFromYml extracts config", () => {
    const tests: YamlTest[] = [
      { relationships: { field: "id", to: "ref" } },
      { accepted_values: { values: ["a", "b"] } },
      { not_null: { severity: "warn" } },
    ];
    expect(
      getColumnTestConfigFromYml(
        tests,
        { field: "id", to: "ref" },
        "relationships",
      ),
    ).toEqual({ field: "id", to: "ref" });
    expect(
      getColumnTestConfigFromYml(
        tests,
        { values: ["b", "a"] },
        "accepted_values",
      ),
    ).toEqual({ values: ["a", "b"] });
    expect(
      getColumnTestConfigFromYml(tests, { severity: "warn" }, "not_null"),
    ).toEqual({ not_null: { severity: "warn" } });
  });

  it("getColumnTestConfigFromYml treats a test listed without config as having none", () => {
    const tests: YamlTest[] = [{ not_null: null }, "unique"];
    expect(getColumnTestConfigFromYml(tests, {}, "not_null")).toBeUndefined();
    expect(getColumnTestConfigFromYml(tests, {}, "unique")).toBeUndefined();
  });

  it("stripANSI removes escape codes", () => {
    const cleaned = stripANSI("\u001b[31mred\u001b[0m");
    expect(cleaned).toBe("red");
  });

  it("getFormattedDateTime formats date", () => {
    const formatted = getFormattedDateTime();
    expect(formatted).toMatch(/^\d{2}-\d{2}-\d{4}-\d{2}-\d{2}-\d{2}$/);
  });

  it("removeProtocol and extractDbtSubcommand strip prefixes", () => {
    expect(removeProtocol("p://models/a.yml")).toBe("models/a.yml");
    expect(extractDbtSubcommand("dbt build --select a")).toBe("build");
    expect(extractDbtSubcommand("build")).toBe("build");
  });

  it("getDepthColor grades depth", () => {
    expect(getDepthColor(1)).toBe("#00ff00");
    expect(getDepthColor(5)).toBe("#ffa500");
    expect(getDepthColor(10)).toBe("#ff0000");
  });
});
