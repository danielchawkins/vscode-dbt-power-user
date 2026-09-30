import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Position, Uri, window, workspace } from "vscode";
import { getExternalProjectNamesFromDbtLoomConfig } from "../../core/manifest";
import {
  arrayEquals,
  debounce,
  getColumnNameByCase,
  getColumnTestConfigFromYml,
  getCurrentlySelectedModelNameInYamlConfig,
  getFirstWorkspacePath,
  getFormattedDateTime,
  getStringSizeInMb,
  isAcceptedValues,
  isColumnNameEqual,
  isEnclosedWithinCodeBlock,
  isQuotedIdentifier,
  isRelationship,
  setupWatcherHandler,
  stripANSI,
} from "../../utils";

describe("utils tests", () => {
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
    const tests = [
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

  it("getExternalProjectNamesFromDbtLoomConfig reads file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-"));
    const file = path.join(dir, "dbt_loom.config.yml");
    fs.writeFileSync(file, "manifests:\n  - name: proj1\n  - name: proj2\n");
    const result = getExternalProjectNamesFromDbtLoomConfig(dir);
    expect(result).toEqual(["proj1", "proj2"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("getExternalProjectNamesFromDbtLoomConfig prefers the override path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-"));
    const file = path.join(dir, "custom-loom.yml");
    fs.writeFileSync(file, "manifests:\n  - name: other\n");
    const result = getExternalProjectNamesFromDbtLoomConfig(
      "/no/such/dir",
      file,
    );
    expect(result).toEqual(["other"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("getExternalProjectNamesFromDbtLoomConfig handles missing file", () => {
    const result = getExternalProjectNamesFromDbtLoomConfig("/no/such/dir");
    expect(result).toBeNull();
  });

  it("setupWatcherHandler wires events", () => {
    const watcher = {
      onDidChange: vi.fn((cb: any) => (cb(), { dispose: vi.fn() })),
      onDidCreate: vi.fn((cb: any) => (cb(), { dispose: vi.fn() })),
      onDidDelete: vi.fn((cb: any) => (cb(), { dispose: vi.fn() })),
    } as any;
    const handler = vi.fn();
    const disposables = setupWatcherHandler(watcher, handler);
    expect(handler).toHaveBeenCalledTimes(3);
    expect(disposables).toHaveLength(3);
  });

  it("arrayEquals compares arrays regardless of order", () => {
    expect(arrayEquals([1, 2], [2, 1])).toBe(true);
    expect(arrayEquals([1, 2], [1, 2, 3])).toBe(false);
  });

  it("debounce delays execution", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn as any, 50);
    debounced();
    vi.advanceTimersByTime(49);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("stripANSI removes escape codes", () => {
    const cleaned = stripANSI("\u001b[31mred\u001b[0m");
    expect(cleaned).toBe("red");
  });

  it("getFormattedDateTime formats date", () => {
    const formatted = getFormattedDateTime();
    expect(formatted).toMatch(/^\d{2}-\d{2}-\d{4}-\d{2}-\d{2}-\d{2}$/);
  });

  it("isEnclosedWithinCodeBlock detects braces", () => {
    const lines = ["{{", "ref('model')", "}}", "other"];
    const document = {
      lineCount: lines.length,
      lineAt: (i: number) => ({ text: lines[i] }),
    } as any;
    const range = { start: new Position(1, 2), end: new Position(1, 5) } as any;
    expect(isEnclosedWithinCodeBlock(document, range)).toBe(true);
    const outside = {
      start: new Position(3, 1),
      end: new Position(3, 2),
    } as any;
    expect(isEnclosedWithinCodeBlock(document, outside)).toBe(false);
  });
});
